from __future__ import annotations

import ctypes
import sys
from pathlib import Path
from types import SimpleNamespace

from desktop_notes.bridge import WindowStateSaver
from desktop_notes.config import ConfigStore
from desktop_notes.main import (
    _allow_system_shutdown,
    _normalize_window_after_show,
    _visible_window_bounds,
)


class FakeEvent:
    def __init__(self) -> None:
        self.handlers: list[object] = []

    def __iadd__(self, handler: object) -> "FakeEvent":
        self.handlers.append(handler)
        return self


class FakeEvents:
    def __init__(self) -> None:
        self.moved = FakeEvent()
        self.resized = FakeEvent()


class FakeWindow:
    def __init__(self) -> None:
        self.events = FakeEvents()
        self.resize_calls: list[tuple[int, int]] = []

    def resize(self, width: int, height: int) -> None:
        assert self.events.moved.handlers == []
        assert self.events.resized.handlers == []
        self.resize_calls.append((width, height))


class FakeStateSaver:
    def schedule(self) -> None:
        pass


def test_initial_size_is_normalized_before_state_tracking_starts() -> None:
    window = FakeWindow()
    saver = FakeStateSaver()

    _normalize_window_after_show(window, saver, 350, 630)

    assert window.resize_calls == [(350, 630)]
    assert window.events.moved.handlers == [saver.schedule]
    assert window.events.resized.handlers == [saver.schedule]


def test_system_shutdown_overrides_pywebview_close_cancellation() -> None:
    shutdown = type("CloseArgs", (), {"CloseReason": "WindowsShutDown", "Cancel": True})()
    user_close = type("CloseArgs", (), {"CloseReason": "UserClosing", "Cancel": True})()

    _allow_system_shutdown(None, shutdown)
    _allow_system_shutdown(None, user_close)

    assert shutdown.Cancel is False
    assert user_close.Cancel is True


def test_default_and_resized_window_dimensions_are_persisted(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "Bitty-Note")
    assert (store.config.window_width, store.config.window_height) == (350, 530)

    window = type(
        "Window",
        (),
        {"x": 120, "y": 80, "width": 428, "height": 712},
    )()
    WindowStateSaver(window, store).flush()

    restored = ConfigStore(config_path, tmp_path / "Bitty-Note").config
    assert (
        restored.window_x,
        restored.window_y,
        restored.window_width,
        restored.window_height,
    ) == (120, 80, 428, 712)


def test_restored_position_uses_its_secondary_monitor_work_area(monkeypatch) -> None:
    class FakeUser32:
        def __init__(self) -> None:
            self.monitor_rect: tuple[int, int, int, int] | None = None

        def SystemParametersInfoW(self, _action, _param, rect_pointer, _flags) -> int:
            rect = rect_pointer._obj
            rect.left, rect.top, rect.right, rect.bottom = 0, 0, 2560, 1392
            return 1

        def MonitorFromRect(self, rect_pointer, _flags) -> int:
            rect = rect_pointer._obj
            self.monitor_rect = (rect.left, rect.top, rect.right, rect.bottom)
            return 2

        def GetMonitorInfoW(self, monitor, info_pointer) -> int:
            assert monitor == 2
            info = info_pointer._obj
            info.rcMonitor.left = 2560
            info.rcMonitor.top = 135
            info.rcMonitor.right = 4267
            info.rcMonitor.bottom = 1202
            info.rcWork.left = 2560
            info.rcWork.top = 135
            info.rcWork.right = 4267
            info.rcWork.bottom = 1154
            return 1

    user32 = FakeUser32()
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(
        ctypes,
        "windll",
        SimpleNamespace(user32=user32),
        raising=False,
    )

    restored = _visible_window_bounds(2800, 300, 350, 530)

    assert restored == (2800, 300, 350, 530)
    assert user32.monitor_rect == (2800, 300, 3150, 830)

    clamped = _visible_window_bounds(4200, 1000, 350, 530)

    assert clamped == (3917, 624, 350, 530)
