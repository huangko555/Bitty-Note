from __future__ import annotations

import ctypes
import sys
from functools import lru_cache

from .config import DEFAULT_EDITOR_FONT


LF_FACESIZE = 32


class _LogFontW(ctypes.Structure):
    _fields_ = [
        ("lfHeight", ctypes.c_long),
        ("lfWidth", ctypes.c_long),
        ("lfEscapement", ctypes.c_long),
        ("lfOrientation", ctypes.c_long),
        ("lfWeight", ctypes.c_long),
        ("lfItalic", ctypes.c_ubyte),
        ("lfUnderline", ctypes.c_ubyte),
        ("lfStrikeOut", ctypes.c_ubyte),
        ("lfCharSet", ctypes.c_ubyte),
        ("lfOutPrecision", ctypes.c_ubyte),
        ("lfClipPrecision", ctypes.c_ubyte),
        ("lfQuality", ctypes.c_ubyte),
        ("lfPitchAndFamily", ctypes.c_ubyte),
        ("lfFaceName", ctypes.c_wchar * LF_FACESIZE),
    ]


class _EnumLogFontExW(ctypes.Structure):
    _fields_ = [
        ("elfLogFont", _LogFontW),
        ("elfFullName", ctypes.c_wchar * 64),
        ("elfStyle", ctypes.c_wchar * 32),
        ("elfScript", ctypes.c_wchar * 32),
    ]


@lru_cache(maxsize=1)
def list_system_fonts() -> list[str]:
    """Return the installed Windows font families without loading a GUI toolkit."""
    if sys.platform != "win32":
        return [DEFAULT_EDITOR_FONT]

    names: set[str] = set()
    callback_type = ctypes.WINFUNCTYPE(
        ctypes.c_int,
        ctypes.POINTER(_EnumLogFontExW),
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_ssize_t,
    )

    def collect(font: ctypes.POINTER(_EnumLogFontExW), *_args: object) -> int:
        name = font.contents.elfLogFont.lfFaceName.strip()
        if name and not name.startswith("@"):
            names.add(name)
        return 1

    callback = callback_type(collect)
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
    user32.GetDC.argtypes = [ctypes.c_void_p]
    user32.GetDC.restype = ctypes.c_void_p
    user32.ReleaseDC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    user32.ReleaseDC.restype = ctypes.c_int
    gdi32.EnumFontFamiliesExW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(_LogFontW),
        callback_type,
        ctypes.c_ssize_t,
        ctypes.c_uint32,
    ]
    gdi32.EnumFontFamiliesExW.restype = ctypes.c_int
    device_context = user32.GetDC(None)
    if not device_context:
        return [DEFAULT_EDITOR_FONT]
    try:
        query = _LogFontW()
        query.lfCharSet = 1  # DEFAULT_CHARSET
        gdi32.EnumFontFamiliesExW(
            device_context,
            ctypes.byref(query),
            callback,
            0,
            0,
        )
    finally:
        user32.ReleaseDC(None, device_context)

    names.add(DEFAULT_EDITOR_FONT)
    return sorted(names, key=str.casefold)
