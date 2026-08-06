from __future__ import annotations

import ctypes
import ctypes.wintypes
import os
import sys


ERROR_INSUFFICIENT_BUFFER = 122
STORE_UPDATES_URL = "ms-windows-store://downloadsandupdates"


def is_store_package() -> bool:
    """Return whether the process is running from an MSIX package."""
    if sys.platform != "win32":
        return False
    try:
        length = ctypes.wintypes.UINT(0)
        result = ctypes.windll.kernel32.GetCurrentPackageFullName(
            ctypes.byref(length), None
        )
    except (AttributeError, OSError):
        return False
    return result == ERROR_INSUFFICIENT_BUFFER


def open_store_updates() -> None:
    if sys.platform != "win32":
        raise OSError("Microsoft Store updates are only available on Windows.")
    os.startfile(STORE_UPDATES_URL)
