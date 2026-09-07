from __future__ import annotations

from pathlib import Path

from desktop_notes.bridge import NoteWindowStateSaver, WindowStateSaver
from desktop_notes.config import ConfigStore
from desktop_notes.main import (
    _MonitorWorkArea,
    _allow_system_shutdown,
    _normalize_window_after_show,
    _restore_open_note_windows,
    _restore_window_from_hidden_start,
    _show_window_when_ready,
    _visible_window_bounds,
)
from desktop_notes.window_coordinator import WindowCoordinator, WindowSession


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


def test_initial_bounds_are_normalized_before_state_tracking_starts(monkeypatch) -> None:
    window = FakeWindow()
    saver = FakeStateSaver()
    move_calls: list[tuple[object, int, int]] = []
    monkeypatch.setattr(
        "desktop_notes.main.move_window_to_physical",
        lambda target, x, y: move_calls.append((target, x, y)),
    )

    _normalize_window_after_show(window, saver, 350, 630, 3644, 386)

    assert move_calls == [(window, 3644, 386)]
    assert window.resize_calls == [(350, 630)]
    assert window.events.moved.handlers == [saver.schedule]
    assert window.events.resized.handlers == [saver.schedule]


def test_hidden_start_restores_window_before_revealing_it(monkeypatch) -> None:
    window = FakeWindow()
    saver = FakeStateSaver()
    calls: list[object] = []
    window.hide = lambda: calls.append("hide")
    window.show = lambda: calls.append("show")
    window.resize = lambda width, height: calls.append(("resize", width, height))
    monkeypatch.setattr(
        "desktop_notes.main.move_window_to_physical",
        lambda _target, x, y: calls.append(("move", x, y)),
    )

    _restore_window_from_hidden_start(window, saver, 350, 630, 3644, 386)

    assert calls == [
        "hide",
        ("move", 3644, 386),
        ("resize", 350, 630),
        "show",
    ]
    assert window.events.moved.handlers == [saver.schedule]
    assert window.events.resized.handlers == [saver.schedule]


def test_auxiliary_window_stays_hidden_until_its_note_ui_is_ready() -> None:
    shown: list[bool] = []
    failed: list[bool] = []
    window = type("LoadingWindow", (), {"show": lambda _self: shown.append(True)})()
    bridge = type("LoadingBridge", (), {})()
    bridge._set_window_ready_callback = lambda callback: setattr(bridge, "ready", callback)

    timer = _show_window_when_ready(window, bridge, lambda: failed.append(True), 30)
    assert shown == []

    bridge.ready()

    assert shown == [True]
    assert failed == []
    timer.cancel()


def test_system_shutdown_overrides_pywebview_close_cancellation() -> None:
    shutdown = type("CloseArgs", (), {"CloseReason": "WindowsShutDown", "Cancel": True})()
    user_close = type("CloseArgs", (), {"CloseReason": "UserClosing", "Cancel": True})()

    _allow_system_shutdown(None, shutdown)
    _allow_system_shutdown(None, user_close)

    assert shutdown.Cancel is False
    assert user_close.Cancel is True


def test_default_and_resized_window_dimensions_are_persisted(
    tmp_path: Path,
    monkeypatch,
) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "Bitty-Note")
    assert (store.config.window_width, store.config.window_height) == (350, 530)

    window = type(
        "Window",
        (),
        {"x": 120, "y": 80, "width": 428, "height": 712},
    )()
    monkeypatch.setattr(
        "desktop_notes.bridge.window_logical_bounds",
        lambda _window: (120, 80, 428, 712),
    )
    WindowStateSaver(window, store).flush()

    restored = ConfigStore(config_path, tmp_path / "Bitty-Note").config
    assert (
        restored.window_x,
        restored.window_y,
        restored.window_width,
        restored.window_height,
    ) == (120, 80, 428, 712)
    assert restored.window_position_space == "logical"


def test_open_note_window_position_and_dimensions_are_persisted(
    tmp_path: Path,
    monkeypatch,
) -> None:
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    coordinator = WindowCoordinator(store)
    window = type("Window", (), {})()
    coordinator.register(WindowSession(
        "note", "note", window, object(), "Travel.md"
    ))
    monkeypatch.setattr(
        "desktop_notes.bridge.window_logical_bounds",
        lambda _window: (-220, 135, 460, 680),
    )

    NoteWindowStateSaver(window, coordinator, "note").flush()

    restored = ConfigStore(store.path, tmp_path / "notes").config
    assert restored.open_note_windows == {
        "Travel.md": {"x": -220, "y": 135, "width": 460, "height": 680}
    }
    assert restored.note_window_sizes == {
        "Travel.md": {"width": 460, "height": 680}
    }


def test_main_window_ready_restores_windows_for_existing_notes() -> None:
    bridge = type("Bridge", (), {
        "list_notes": lambda _self: [
            {"name": "First.md"},
            {"name": "Second.md"},
        ]
    })()
    restored: list[list[str]] = []
    coordinator = type("Coordinator", (), {
        "restore_auxiliaries": lambda _self, names: restored.append(names)
    })()

    _restore_open_note_windows(bridge, coordinator)

    assert restored == [["First.md", "Second.md"]]


def test_restored_position_uses_its_secondary_monitor_work_area(monkeypatch) -> None:
    monkeypatch.setattr(
        "desktop_notes.main._monitor_work_areas",
        lambda: [
            _MonitorWorkArea(0, 0, 2560, 1392, 96),
            _MonitorWorkArea(2560, 135, 4267, 1154, 96),
        ],
    )
    monkeypatch.setattr("desktop_notes.main.sys.platform", "win32")

    restored = _visible_window_bounds(2800, 300, 350, 530)

    assert restored == (2800, 300, 350, 530)

    clamped = _visible_window_bounds(4200, 1000, 350, 530)

    assert clamped == (3917, 624, 350, 530)


def test_logical_position_is_restored_to_physical_secondary_monitor_coordinates(
    monkeypatch,
) -> None:
    monitors = [
        _MonitorWorkArea(0, 0, 2560, 1392, 96),
        _MonitorWorkArea(2560, 135, 4267, 1154, 144),
    ]
    monkeypatch.setattr(
        "desktop_notes.main._monitor_work_areas",
        lambda: monitors,
    )
    monkeypatch.setattr("desktop_notes.main.sys.platform", "win32")

    restored = _visible_window_bounds(
        2429,
        257,
        316,
        491,
        position_space="logical",
    )

    assert restored == (3644, 386, 316, 491)


def test_legacy_physical_position_is_preserved_on_scaled_secondary_monitor(
    monkeypatch,
) -> None:
    monitors = [
        _MonitorWorkArea(0, 0, 2560, 1392, 96),
        _MonitorWorkArea(2560, 135, 4267, 1154, 144),
    ]
    monkeypatch.setattr(
        "desktop_notes.main._monitor_work_areas",
        lambda: monitors,
    )
    monkeypatch.setattr("desktop_notes.main.sys.platform", "win32")

    restored = _visible_window_bounds(2800, 300, 350, 530)

    assert restored == (2800, 300, 350, 530)
