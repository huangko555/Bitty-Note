from __future__ import annotations

import ctypes
import ctypes.wintypes
import logging
import sys
import threading
from pathlib import Path

import webview
import velopack

from .bridge import DesktopBridge, NoteWindowSizeSaver, WindowStateSaver
from .config import ConfigStore
from .distribution import is_store_package
from .i18n import set_language, text
from .platform_windows import (
    documents_directory,
    local_config_path,
    set_autostart,
)
from .window_coordinator import WindowCoordinator, WindowSession


MIN_WINDOW_WIDTH = 300
MIN_WINDOW_HEIGHT = 380


def _resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    return base / relative


def _visible_window_bounds(
    x: int | None,
    y: int | None,
    width: int,
    height: int,
) -> tuple[int | None, int | None, int, int]:
    width = max(MIN_WINDOW_WIDTH, width)
    height = max(MIN_WINDOW_HEIGHT, height)
    if sys.platform != "win32" or x is None or y is None:
        return x, y, width, height

    work_area = ctypes.wintypes.RECT()
    ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(work_area), 0)
    max_width = max(MIN_WINDOW_WIDTH, work_area.right - work_area.left)
    max_height = max(MIN_WINDOW_HEIGHT, work_area.bottom - work_area.top)
    width = min(width, max_width)
    height = min(height, max_height)
    if x + 80 < work_area.left or x > work_area.right - 80:
        x = work_area.left + 40
    if y + 42 < work_area.top or y > work_area.bottom - 42:
        y = work_area.top + 40
    return x, y, width, height


def _single_instance() -> object | None:
    if sys.platform != "win32":
        return object()
    create_mutex = ctypes.windll.kernel32.CreateMutexW
    create_mutex.restype = ctypes.wintypes.HANDLE
    handle = create_mutex(None, False, "Local\\Bitty.Singleton")
    if not handle or ctypes.windll.kernel32.GetLastError() == 183:
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
        return None
    return handle


def _normalize_window_after_show(
    window: webview.Window,
    state_saver: object,
    width: int,
    height: int,
) -> None:
    # WinForms applies the frameless style after its initial size. Resizing once
    # after the native window is shown prevents the removed frame dimensions
    # from being subtracted again on every restart.
    window.resize(width, height)
    window.events.moved += state_saver.schedule  # type: ignore[attr-defined]
    window.events.resized += state_saver.schedule  # type: ignore[attr-defined]


def _normalize_note_window_after_show(
    window: webview.Window,
    state_saver: NoteWindowSizeSaver,
    width: int,
    height: int,
) -> None:
    window.resize(width, height)
    window.events.resized += state_saver.schedule


def _allow_system_shutdown(_sender: object, args: object) -> None:
    """Undo pywebview's generic cancellation for a WinForms session shutdown."""
    if str(getattr(args, "CloseReason", "")) == "WindowsShutDown":
        setattr(args, "Cancel", False)


def main() -> None:
    if not is_store_package():
        velopack.App().run()
    instance = _single_instance()
    if instance is None:
        return

    logging.basicConfig(level=logging.ERROR)
    default_notes = documents_directory() / "Bitty-Note"
    config_store = ConfigStore(local_config_path(), default_notes)
    config = config_store.config
    set_language(config.language)
    if config.autostart:
        try:
            set_autostart(True)
        except Exception:
            logging.exception("Failed to refresh the Bitty autostart entry.")
    Path(config.save_dir).mkdir(parents=True, exist_ok=True)
    x, y, width, height = _visible_window_bounds(
        config.window_x,
        config.window_y,
        config.window_width,
        config.window_height,
    )

    index = _resource_path("dist/web/index.html")
    if not index.is_file():
        raise RuntimeError("Web assets are missing. Run npm run build first.")

    coordinator = WindowCoordinator(config_store)
    bridge = DesktopBridge(config_store, coordinator)
    window = webview.create_window(
        text("Bitty", "小记"),
        str(index),
        js_api=bridge,
        width=width,
        height=height,
        x=x,
        y=y,
        min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
        frameless=True,
        easy_drag=False,
        on_top=config.always_on_top,
        confirm_close=False,
        background_color="#fffdf5",
    )
    bridge.attach_window(window)
    state_saver = WindowStateSaver(window, config_store)
    coordinator.register(
        WindowSession("main", "main", window, bridge), refresh_titles=False
    )

    def wire_window(
        target_window: webview.Window,
        target_bridge: DesktopBridge,
        target_state_saver: WindowStateSaver | NoteWindowSizeSaver,
        target_width: int,
        target_height: int,
        *,
        track_position: bool,
        already_shown: bool = False,
        unregister_session: str | None = None,
    ) -> None:
        def on_shown() -> None:
            if track_position:
                _normalize_window_after_show(
                    target_window, target_state_saver, target_width, target_height
                )
            else:
                _normalize_note_window_after_show(
                    target_window,
                    target_state_saver,  # type: ignore[arg-type]
                    target_width,
                    target_height,
                )
            if sys.platform == "win32":
                target_window.native.FormClosing += _allow_system_shutdown

        if already_shown:
            on_shown()
        else:
            target_window.events.shown += on_shown
        close_request_lock = threading.Lock()
        close_request_pending = False

        def request_page_close() -> None:
            nonlocal close_request_pending
            try:
                target_window.run_js("window.desktopNotesRequestClose?.()")
            finally:
                def clear_pending() -> None:
                    nonlocal close_request_pending
                    with close_request_lock:
                        close_request_pending = False

                reset_timer = threading.Timer(1.0, clear_pending)
                reset_timer.daemon = True
                reset_timer.start()

        def on_closing() -> bool | None:
            nonlocal close_request_pending
            if target_bridge.allow_close:
                target_state_saver.flush()
                return None
            with close_request_lock:
                if not close_request_pending:
                    close_request_pending = True
                    request_timer = threading.Timer(0.05, request_page_close)
                    request_timer.daemon = True
                    request_timer.start()
            return False

        target_window.events.closing += on_closing
        if unregister_session is not None:
            target_window.events.closed += lambda: coordinator.unregister(unregister_session)

    wire_window(window, bridge, state_saver, width, height, track_position=True)

    def create_auxiliary(
        session_id: str,
        note_name: str,
        requested_width: int,
        requested_height: int,
        requested_x: int,
        requested_y: int,
    ) -> None:
        note_x, note_y, note_width, note_height = _visible_window_bounds(
            requested_x,
            requested_y,
            requested_width,
            requested_height,
        )
        note_bridge = DesktopBridge(
            config_store,
            coordinator,
            session_id=session_id,
            window_role="note",
            initial_note=note_name,
        )
        note_window = webview.create_window(
            Path(note_name).stem,
            str(index),
            js_api=note_bridge,
            width=note_width,
            height=note_height,
            x=note_x,
            y=note_y,
            min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
            frameless=True,
            easy_drag=False,
            on_top=False,
            hidden=True,
            confirm_close=False,
            background_color="#fffdf5",
        )
        note_bridge.attach_window(note_window)
        note_state_saver = NoteWindowSizeSaver(
            note_window, coordinator, session_id
        )
        coordinator.register(WindowSession(
            session_id,
            "note",
            note_window,
            note_bridge,
            note_name,
            note_state_saver,
        ))
        try:
            wire_window(
                note_window,
                note_bridge,
                note_state_saver,
                note_width,
                note_height,
                track_position=False,
                already_shown=True,
                unregister_session=session_id,
            )
            note_window.show()
        except Exception:
            coordinator.unregister(session_id)
            note_bridge.allow_close = True
            try:
                note_window.destroy()
            except Exception:
                pass
            raise

    coordinator.set_auxiliary_factory(create_auxiliary)
    webview.start(gui="edgechromium", debug=False, private_mode=True)

    if sys.platform == "win32" and isinstance(instance, int):
        ctypes.windll.kernel32.CloseHandle(instance)


if __name__ == "__main__":
    main()
