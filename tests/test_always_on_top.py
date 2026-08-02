from __future__ import annotations

from pathlib import Path

import pytest

from desktop_notes import bridge as bridge_module
from desktop_notes.bridge import DesktopBridge
from desktop_notes.config import ConfigStore


def test_topmost_rolls_back_when_config_cannot_be_saved(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store)
    window = object()
    bridge.attach_window(window)  # type: ignore[arg-type]
    applied: list[bool] = []
    monkeypatch.setattr(
        bridge_module,
        "set_window_topmost",
        lambda _window, enabled: applied.append(enabled),
    )

    def fail_update(**_changes: object) -> None:
        raise OSError("config is busy")

    monkeypatch.setattr(store, "update", fail_update)

    with pytest.raises(OSError, match="config is busy"):
        bridge.set_always_on_top(True)

    assert applied == [True, False]


def test_reading_native_topmost_repairs_stale_config(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    store.update(always_on_top=True)
    bridge = DesktopBridge(store)
    window = object()
    bridge.attach_window(window)  # type: ignore[arg-type]
    monkeypatch.setattr(
        bridge_module,
        "is_window_topmost",
        lambda _window: False,
        raising=False,
    )

    assert bridge.get_always_on_top() == {"enabled": False}
    assert store.config.always_on_top is False
