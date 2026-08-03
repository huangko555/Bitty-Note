from __future__ import annotations

import ctypes
import ctypes.wintypes
import sys
from dataclasses import dataclass
from pathlib import Path

from send2trash import send2trash

from .errors import UserVisibleError
from .i18n import text as message

_APP_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_APP_RUN_NAME = "Bitty"
_LEGACY_APP_RUN_NAME = "DesktopNotes"
_WINDOW_REGIONS = {
    "caption",
    "left",
    "right",
    "top",
    "top_left",
    "top_right",
    "bottom",
    "bottom_left",
    "bottom_right",
}


@dataclass(frozen=True)
class WindowInteraction:
    region: str
    handle: int
    cursor_x: int
    cursor_y: int
    left: int
    top: int
    right: int
    bottom: int
    min_width: int
    min_height: int


def documents_directory() -> Path:
    if sys.platform != "win32":
        return Path.home() / "Documents"
    buffer = ctypes.create_unicode_buffer(32768)
    result = ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buffer)
    return Path(buffer.value) if result == 0 and buffer.value else Path.home() / "Documents"


def local_config_path() -> Path:
    import os

    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    # Keep the legacy location so an application rename never loses user settings.
    return base / "DesktopNotes" / "config.json"


def send_file_to_trash(path: Path) -> None:
    send2trash(str(path))


def open_directory(path: Path) -> None:
    if sys.platform != "win32":
        raise UserVisibleError(message(
            "Opening folders isn't supported on this system.",
            "当前系统不支持打开文件夹。",
        ))
    directory = path.resolve()
    if not directory.is_dir():
        raise UserVisibleError(message("The storage folder doesn't exist.", "保存目录不存在。"))
    import os

    try:
        os.startfile(str(directory))
    except OSError as error:
        raise UserVisibleError(message(
            f"Couldn't open the storage folder: {error}",
            f"无法打开保存目录：{error}",
        )) from error


def set_window_topmost(window: object, enabled: bool) -> None:
    """Toggle topmost without touching WinForms from pywebview's worker thread."""
    if sys.platform != "win32":
        setattr(window, "on_top", enabled)
        return

    native = getattr(window, "native", None)
    handle_object = getattr(native, "Handle", None)
    if handle_object is None:
        raise UserVisibleError(message(
            "The window isn't ready to change its always-on-top state.",
            "窗口尚未准备完成，无法切换置顶状态。",
        ))

    handle = int(handle_object.ToInt64())
    set_window_position = ctypes.windll.user32.SetWindowPos
    set_window_position.argtypes = [
        ctypes.wintypes.HWND,
        ctypes.wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.wintypes.UINT,
    ]
    set_window_position.restype = ctypes.wintypes.BOOL

    insert_after = ctypes.wintypes.HWND(-1 if enabled else -2)
    flags = 0x0001 | 0x0002 | 0x0010 | 0x4000  # NOSIZE | NOMOVE | NOACTIVATE | ASYNC
    if not set_window_position(handle, insert_after, 0, 0, 0, 0, flags):
        raise UserVisibleError(message(
            f"Couldn't change the always-on-top state: {ctypes.WinError()}",
            f"切换窗口置顶状态失败：{ctypes.WinError()}",
        ))


def is_window_topmost(window: object) -> bool:
    if sys.platform != "win32":
        return bool(getattr(window, "on_top", False))

    native = getattr(window, "native", None)
    handle_object = getattr(native, "Handle", None)
    if handle_object is None:
        raise UserVisibleError(message(
            "The window isn't ready to read its always-on-top state.",
            "窗口尚未准备完成，无法读取置顶状态。",
        ))

    handle = int(handle_object.ToInt64())
    get_window_long = getattr(ctypes.windll.user32, "GetWindowLongPtrW", None)
    if get_window_long is None:
        get_window_long = ctypes.windll.user32.GetWindowLongW
    get_window_long.argtypes = [ctypes.wintypes.HWND, ctypes.c_int]
    get_window_long.restype = ctypes.c_ssize_t
    return bool(get_window_long(handle, -20) & 0x8)  # GWL_EXSTYLE / WS_EX_TOPMOST


def start_window_interaction(window: object, region: str) -> WindowInteraction:
    if sys.platform != "win32" or region not in _WINDOW_REGIONS:
        raise UserVisibleError(message(
            "This window action isn't supported on the current system.",
            "当前系统不支持此窗口操作。",
        ))

    native = getattr(window, "native", None)
    handle_object = getattr(native, "Handle", None)
    if handle_object is None:
        raise UserVisibleError(message("The window isn't ready yet.", "窗口尚未准备完成。"))

    handle = int(handle_object.ToInt64())
    cursor = ctypes.wintypes.POINT()
    rect = ctypes.wintypes.RECT()
    if not ctypes.windll.user32.GetCursorPos(ctypes.byref(cursor)):
        raise UserVisibleError(message(
            "Couldn't read the pointer position.", "无法读取鼠标位置。"
        ))
    if not ctypes.windll.user32.GetWindowRect(handle, ctypes.byref(rect)):
        raise UserVisibleError(message(
            "Couldn't read the window position.", "无法读取窗口位置。"
        ))
    dpi = ctypes.windll.user32.GetDpiForWindow(handle) or 96
    return WindowInteraction(
        region=region,
        handle=handle,
        cursor_x=cursor.x,
        cursor_y=cursor.y,
        left=rect.left,
        top=rect.top,
        right=rect.right,
        bottom=rect.bottom,
        min_width=round(300 * dpi / 96),
        min_height=round(380 * dpi / 96),
    )


def update_window_interaction(interaction: WindowInteraction) -> None:
    cursor = ctypes.wintypes.POINT()
    if not ctypes.windll.user32.GetCursorPos(ctypes.byref(cursor)):
        return

    dx = cursor.x - interaction.cursor_x
    dy = cursor.y - interaction.cursor_y
    left, top = interaction.left, interaction.top
    right, bottom = interaction.right, interaction.bottom
    region = interaction.region

    if region == "caption":
        left += dx
        right += dx
        top += dy
        bottom += dy
    else:
        if "left" in region:
            left = min(left + dx, right - interaction.min_width)
        if "right" in region:
            right = max(right + dx, left + interaction.min_width)
        if "top" in region:
            top = min(top + dy, bottom - interaction.min_height)
        if "bottom" in region:
            bottom = max(bottom + dy, top + interaction.min_height)

    set_window_position = ctypes.windll.user32.SetWindowPos
    set_window_position.argtypes = [
        ctypes.wintypes.HWND,
        ctypes.wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.wintypes.UINT,
    ]
    set_window_position.restype = ctypes.wintypes.BOOL
    flags = 0x0004 | 0x0010 | 0x4000  # NOZORDER | NOACTIVATE | ASYNC
    set_window_position(
        interaction.handle,
        None,
        left,
        top,
        right - left,
        bottom - top,
        flags,
    )


def set_autostart(enabled: bool) -> None:
    if sys.platform != "win32":
        raise UserVisibleError(message(
            "Launch at startup isn't supported on this system.",
            "当前系统不支持开机自启设置。",
        ))
    import winreg

    if getattr(sys, "frozen", False):
        command = f'"{sys.executable}"'
    else:
        pythonw = Path(sys.executable).with_name("pythonw.exe")
        command = f'"{pythonw}" -m desktop_notes.main'
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _APP_RUN_KEY, 0, winreg.KEY_SET_VALUE
        ) as key:
            if enabled:
                winreg.SetValueEx(key, _APP_RUN_NAME, 0, winreg.REG_SZ, command)
                try:
                    winreg.DeleteValue(key, _LEGACY_APP_RUN_NAME)
                except FileNotFoundError:
                    pass
            else:
                for value_name in (_APP_RUN_NAME, _LEGACY_APP_RUN_NAME):
                    try:
                        winreg.DeleteValue(key, value_name)
                    except FileNotFoundError:
                        pass
    except OSError as error:
        raise UserVisibleError(message(
            f"Couldn't change the launch-at-startup setting: {error}",
            f"无法修改开机自启设置：{error}",
        )) from error
