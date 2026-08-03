from __future__ import annotations

from pathlib import Path

from desktop_notes.bridge import DesktopBridge
from desktop_notes.config import ConfigStore


class WindowStub:
    def __init__(self) -> None:
        self.title = ""

    def set_title(self, title: str) -> None:
        self.title = title


def test_language_change_updates_taskbar_window_title(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store)
    window = WindowStub()
    bridge.attach_window(window)  # type: ignore[arg-type]

    assert bridge.set_language("zh-CN") == {"language": "zh-CN"}
    assert window.title == "小记"
    assert bridge.set_language("en") == {"language": "en"}
    assert window.title == "Bitty"

