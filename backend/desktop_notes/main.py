from __future__ import annotations

import ctypes
import ctypes.wintypes
import logging
import sys
import threading
from pathlib import Path

import webview
import velopack

from .bridge import DesktopBridge, WindowStateSaver
from .config import ConfigStore
from .i18n import set_language, text
from .platform_windows import (
    documents_directory,
    local_config_path,
    set_autostart,
)


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
    state_saver: WindowStateSaver,
    width: int,
    height: int,
) -> None:
    # WinForms applies the frameless style after its initial size. Resizing once
    # after the native window is shown prevents the removed frame dimensions
    # from being subtracted again on every restart.
    window.resize(width, height)
    window.events.moved += state_saver.schedule
    window.events.resized += state_saver.schedule


def _allow_system_shutdown(_sender: object, args: object) -> None:
    """Undo pywebview's generic cancellation for a WinForms session shutdown."""
    if str(getattr(args, "CloseReason", "")) == "WindowsShutDown":
        setattr(args, "Cancel", False)


def main() -> None:
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

    bridge = DesktopBridge(config_store)
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

    def on_shown() -> None:
        _normalize_window_after_show(window, state_saver, width, height)
        if sys.platform == "win32":
            window.native.FormClosing += _allow_system_shutdown

    window.events.shown += on_shown
    close_request_lock = threading.Lock()
    close_request_pending = False

    def request_page_close() -> None:
        nonlocal close_request_pending
        try:
            window.run_js("window.desktopNotesRequestClose?.()")
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
        if bridge.allow_close:
            state_saver.flush()
            return None
        with close_request_lock:
            if not close_request_pending:
                close_request_pending = True
                request_timer = threading.Timer(0.05, request_page_close)
                request_timer.daemon = True
                request_timer.start()
        return False

    window.events.closing += on_closing
    webview.start(gui="edgechromium", debug=False, private_mode=True)

    if sys.platform == "win32" and isinstance(instance, int):
        ctypes.windll.kernel32.CloseHandle(instance)


if __name__ == "__main__":
    main()
