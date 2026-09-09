from __future__ import annotations

import ctypes
import ctypes.wintypes
import logging
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import webview
import velopack

from .bridge import DesktopBridge, NoteWindowStateSaver, WindowStateSaver
from .config import ConfigStore
from .distribution import is_store_package
from .i18n import set_language, text
from .platform_windows import (
    MIN_WINDOW_HEIGHT,
    MIN_WINDOW_WIDTH,
    documents_directory,
    enable_taskbar_minimize,
    local_config_path,
    move_window_to_physical,
    set_autostart,
)
from .window_coordinator import WindowCoordinator, WindowSession


AUXILIARY_LOAD_TIMEOUT_SECONDS = 12.0
SINGLE_INSTANCE_MUTEX_NAME = "Local\\Bitty.Singleton"
SHOW_MAIN_EVENT_NAME = "Local\\Bitty.ShowMain"


def _show_window_when_ready(
    target_window: object,
    target_bridge: DesktopBridge,
    on_failure: Callable[[], None],
    timeout_seconds: float = AUXILIARY_LOAD_TIMEOUT_SECONDS,
) -> threading.Timer:
    """Keep a child window hidden until its note UI reports that it is ready."""
    completion_lock = threading.Lock()
    completed = False

    def finish() -> bool:
        nonlocal completed
        with completion_lock:
            if completed:
                return False
            completed = True
            return True

    def reveal() -> None:
        if not finish():
            return
        timer.cancel()
        try:
            target_window.show()
        except Exception:
            logging.exception("Failed to reveal a loaded auxiliary window.")
            on_failure()

    def fail() -> None:
        if not finish():
            return
        logging.error("Auxiliary window did not finish loading before the timeout.")
        on_failure()

    timer = threading.Timer(timeout_seconds, fail)
    timer.daemon = True
    target_bridge._set_window_ready_callback(reveal)
    timer.start()
    return timer


class _MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.wintypes.DWORD),
        ("rcMonitor", ctypes.wintypes.RECT),
        ("rcWork", ctypes.wintypes.RECT),
        ("dwFlags", ctypes.wintypes.DWORD),
    ]


@dataclass(frozen=True)
class _MonitorWorkArea:
    left: int
    top: int
    right: int
    bottom: int
    dpi: int


def _monitor_work_areas() -> list[_MonitorWorkArea]:
    user32 = ctypes.windll.user32
    shcore = ctypes.windll.shcore
    monitors: list[_MonitorWorkArea] = []
    callback_type = ctypes.WINFUNCTYPE(
        ctypes.wintypes.BOOL,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.wintypes.RECT),
        ctypes.wintypes.LPARAM,
    )

    get_monitor_info = user32.GetMonitorInfoW
    get_monitor_info.argtypes = [ctypes.c_void_p, ctypes.POINTER(_MONITORINFO)]
    get_monitor_info.restype = ctypes.wintypes.BOOL
    get_dpi = shcore.GetDpiForMonitor
    get_dpi.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.POINTER(ctypes.wintypes.UINT),
        ctypes.POINTER(ctypes.wintypes.UINT),
    ]
    get_dpi.restype = ctypes.c_long

    def collect(
        monitor: int,
        _device_context: int,
        _monitor_rect: object,
        _data: int,
    ) -> bool:
        info = _MONITORINFO()
        info.cbSize = ctypes.sizeof(info)
        if get_monitor_info(monitor, ctypes.byref(info)):
            dpi_x = ctypes.wintypes.UINT(96)
            dpi_y = ctypes.wintypes.UINT(96)
            if get_dpi(monitor, 0, ctypes.byref(dpi_x), ctypes.byref(dpi_y)) != 0:
                dpi_x.value = 96
            monitors.append(_MonitorWorkArea(
                info.rcWork.left,
                info.rcWork.top,
                info.rcWork.right,
                info.rcWork.bottom,
                int(dpi_x.value or 96),
            ))
        return True

    callback = callback_type(collect)
    enum_display_monitors = user32.EnumDisplayMonitors
    enum_display_monitors.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        callback_type,
        ctypes.wintypes.LPARAM,
    ]
    enum_display_monitors.restype = ctypes.wintypes.BOOL
    enum_display_monitors(None, None, callback, 0)
    if monitors:
        return monitors

    work_area = ctypes.wintypes.RECT()
    user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(work_area), 0)
    return [_MonitorWorkArea(
        work_area.left,
        work_area.top,
        work_area.right,
        work_area.bottom,
        96,
    )]


def _resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    return base / relative


def _visible_window_bounds(
    x: int | None,
    y: int | None,
    width: int,
    height: int,
    position_space: str | None = None,
) -> tuple[int | None, int | None, int, int]:
    width = max(MIN_WINDOW_WIDTH, width)
    height = max(MIN_WINDOW_HEIGHT, height)
    if sys.platform != "win32" or x is None or y is None:
        return x, y, width, height

    candidates: list[tuple[float, int, _MonitorWorkArea, int, int]] = []
    for monitor in _monitor_work_areas():
        scale = monitor.dpi / 96
        physical_width = round(width * scale)
        physical_height = round(height * scale)
        interpretations = []
        if position_space in (None, "physical"):
            interpretations.append((x, y))
        if position_space in (None, "logical"):
            interpretations.append((round(x * scale), round(y * scale)))
        for physical_x, physical_y in interpretations:
            overlap_width = max(
                0,
                min(physical_x + physical_width, monitor.right)
                - max(physical_x, monitor.left),
            )
            overlap_height = max(
                0,
                min(physical_y + physical_height, monitor.bottom)
                - max(physical_y, monitor.top),
            )
            overlap = overlap_width * overlap_height
            area = max(1, physical_width * physical_height)
            candidates.append((overlap / area, overlap, monitor, physical_x, physical_y))

    _, _, work_area, physical_x, physical_y = max(
        candidates,
        key=lambda item: (item[0], item[1]),
    )
    scale = work_area.dpi / 96
    max_width = max(MIN_WINDOW_WIDTH, int((work_area.right - work_area.left) / scale))
    max_height = max(MIN_WINDOW_HEIGHT, int((work_area.bottom - work_area.top) / scale))
    width = min(width, max_width)
    height = min(height, max_height)
    physical_width = round(width * scale)
    physical_height = round(height * scale)
    physical_x = max(work_area.left, min(physical_x, work_area.right - physical_width))
    physical_y = max(work_area.top, min(physical_y, work_area.bottom - physical_height))
    return physical_x, physical_y, width, height


def _single_instance() -> tuple[object, object | None] | None:
    if sys.platform != "win32":
        return object(), None
    create_event = ctypes.windll.kernel32.CreateEventW
    create_event.restype = ctypes.wintypes.HANDLE
    activation_event = create_event(None, False, False, SHOW_MAIN_EVENT_NAME)
    create_mutex = ctypes.windll.kernel32.CreateMutexW
    create_mutex.restype = ctypes.wintypes.HANDLE
    handle = create_mutex(None, False, SINGLE_INSTANCE_MUTEX_NAME)
    if not handle or ctypes.windll.kernel32.GetLastError() == 183:
        if activation_event:
            ctypes.windll.kernel32.SetEvent(activation_event)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
        if activation_event:
            ctypes.windll.kernel32.CloseHandle(activation_event)
        return None
    return handle, activation_event


def _watch_for_main_window_requests(
    activation_event: object | None,
    coordinator: WindowCoordinator,
) -> None:
    if sys.platform != "win32" or not activation_event:
        return

    def wait_for_activation() -> None:
        wait_for_single_object = ctypes.windll.kernel32.WaitForSingleObject
        while wait_for_single_object(activation_event, 0xFFFFFFFF) == 0:
            try:
                coordinator.show_main()
            except Exception:
                logging.exception("Failed to show the main window after reactivation.")

    watcher = threading.Thread(target=wait_for_activation, daemon=True)
    watcher.start()


def _normalize_window_after_show(
    window: webview.Window,
    state_saver: object,
    width: int,
    height: int,
    x: int | None = None,
    y: int | None = None,
) -> None:
    # WinForms applies the frameless style after its initial size. Resizing once
    # after the native window is shown prevents the removed frame dimensions
    # from being subtracted again on every restart.
    if x is not None and y is not None:
        move_window_to_physical(window, x, y)
    window.resize(width, height)
    window.events.moved += state_saver.schedule  # type: ignore[attr-defined]
    window.events.resized += state_saver.schedule  # type: ignore[attr-defined]


def _restore_window_from_hidden_start(
    window: webview.Window,
    state_saver: object,
    width: int,
    height: int,
    x: int | None = None,
    y: int | None = None,
    *,
    reveal: bool = True,
) -> None:
    # pywebview briefly shows an opacity-zero window to initialize WinForms when
    # hidden=True. Hiding once more synchronizes with that native cycle before
    # the restored bounds are applied and the real first frame is revealed.
    window.hide()
    _normalize_window_after_show(window, state_saver, width, height, x, y)
    if reveal:
        window.show()


def _normalize_note_window_after_show(
    window: webview.Window,
    state_saver: NoteWindowStateSaver,
    width: int,
    height: int,
) -> None:
    window.resize(width, height)
    window.events.moved += state_saver.schedule
    window.events.resized += state_saver.schedule
    state_saver.flush()


def _allow_system_shutdown(_sender: object, args: object) -> None:
    """Undo pywebview's generic cancellation for a WinForms session shutdown."""
    if str(getattr(args, "CloseReason", "")) == "WindowsShutDown":
        setattr(args, "Cancel", False)


def _restore_open_note_windows(
    bridge: DesktopBridge,
    coordinator: WindowCoordinator,
) -> list[str]:
    try:
        names = [note["name"] for note in bridge.list_notes()]
        return coordinator.restore_auxiliaries(names)
    except Exception:
        logging.exception("Failed to restore auxiliary note windows.")
        return []


def main() -> None:
    if not is_store_package():
        velopack.App().run()
    instance_handles = _single_instance()
    if instance_handles is None:
        return
    instance, activation_event = instance_handles

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
        config.window_position_space,
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
        x=None,
        y=None,
        min_size=(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
        frameless=True,
        easy_drag=False,
        on_top=False,
        hidden=True,
        confirm_close=False,
        background_color="#fffdf5",
    )
    bridge.attach_window(window)
    state_saver = WindowStateSaver(window, config_store)
    coordinator.register(
        WindowSession(
            "main",
            "main",
            window,
            bridge,
            state_saver=state_saver,
        ),
        refresh_titles=False,
    )

    def wire_window(
        target_window: webview.Window,
        target_bridge: DesktopBridge,
        target_state_saver: WindowStateSaver | NoteWindowStateSaver,
        target_width: int,
        target_height: int,
        *,
        track_position: bool,
        reveal_on_shown: bool = True,
        already_shown: bool = False,
        unregister_session: str | None = None,
    ) -> None:
        shown_initialized = False

        def on_shown() -> None:
            nonlocal shown_initialized
            if shown_initialized:
                return
            shown_initialized = True
            enable_taskbar_minimize(target_window)
            if track_position:
                _restore_window_from_hidden_start(
                    target_window,
                    target_state_saver,
                    target_width,
                    target_height,
                    x,
                    y,
                    reveal=reveal_on_shown,
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

    wire_window(
        window,
        bridge,
        state_saver,
        width,
        height,
        track_position=True,
        reveal_on_shown=False,
    )

    def create_auxiliary(
        session_id: str,
        note_name: str,
        requested_width: int,
        requested_height: int,
        requested_x: int,
        requested_y: int,
        requested_position_space: str | None,
    ) -> None:
        note_x, note_y, note_width, note_height = _visible_window_bounds(
            requested_x,
            requested_y,
            requested_width,
            requested_height,
            requested_position_space,
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
        note_state_saver = NoteWindowStateSaver(
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

            def load_failed() -> None:
                coordinator.show_main()
                try:
                    window.run_js("window.desktopNotesShowAuxiliaryLoadFailure?.()")
                except Exception:
                    pass
                coordinator.close_session(session_id)
                coordinator.unregister(session_id)

            _show_window_when_ready(note_window, note_bridge, load_failed)
        except Exception:
            try:
                coordinator.close_session(session_id)
            except Exception:
                pass
            coordinator.unregister(session_id)
            raise

    coordinator.set_auxiliary_factory(create_auxiliary)

    def restore_notes_or_show_main() -> None:
        if not _restore_open_note_windows(bridge, coordinator):
            coordinator.show_main()
        _watch_for_main_window_requests(activation_event, coordinator)

    bridge._set_window_ready_callback(restore_notes_or_show_main)
    webview.start(gui="edgechromium", debug=False, private_mode=True)

    if sys.platform == "win32" and isinstance(instance, int):
        ctypes.windll.kernel32.CloseHandle(instance)
    if sys.platform == "win32" and isinstance(activation_event, int):
        ctypes.windll.kernel32.CloseHandle(activation_event)


if __name__ == "__main__":
    main()
