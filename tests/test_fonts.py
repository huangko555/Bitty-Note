from __future__ import annotations

from desktop_notes.config import DEFAULT_EDITOR_FONT
from desktop_notes.fonts import list_system_fonts


def test_system_fonts_are_unique_and_include_default() -> None:
    fonts = list_system_fonts()

    assert DEFAULT_EDITOR_FONT in fonts
    assert len(fonts) == len(set(fonts))
    assert all(font and not font.startswith("@") for font in fonts)
