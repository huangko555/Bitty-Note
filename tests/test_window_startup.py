from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest

from desktop_notes.bridge import DesktopBridge
from desktop_notes.config import ConfigStore
from desktop_notes.errors import UserVisibleError
from desktop_notes.main import _handle_auxiliary_load_failure, _show_window_when_ready
from desktop_notes.window_coordinator import WindowCoordinator, WindowSession


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, callback):
        self.handlers.append(callback)
        return self

    def emit(self):
        for callback in self.handlers:
            callback()


class Window:
    x, y = 100, 80
    native = None

    def __init__(self):
        self.shown = 0
        self.destroyed = 0
        self.events = SimpleNamespace(closed=Event())

    def show(self):
        self.shown += 1

    def set_title(self, _title):
        pass

    def run_js(self, _script):
        pass

    def destroy(self):
        self.destroyed += 1
        self.events.closed.emit()


def test_repeated_open_and_rename_do_not_reveal_a_loading_note(tmp_path, monkeypatch):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    coordinator = WindowCoordinator(store)
    coordinator.register(WindowSession("main", "main", Window(), SimpleNamespace()))
    child = Window()
    bridge = DesktopBridge(store, coordinator, session_id="note", window_role="note", initial_note="Probe.md")
    coordinator.register(WindowSession("note", "note", child, bridge, "Probe.md", loading=True))
    monkeypatch.setattr("desktop_notes.window_coordinator.focus_window", lambda window: window.show())
    coordinator.set_auxiliary_factory(lambda *_args: pytest.fail("must reuse the pending window"))

    for _ in range(5):
        assert coordinator.open_auxiliary("probe.MD") == {"status": "focused"}
    assert coordinator.request_note_rename("Probe.md") == {"status": "focused"}
    assert child.shown == 0

    coordinator.mark_ready("note")
    coordinator.open_auxiliary("Probe.md")
    assert child.shown == 1


def test_failed_startup_ignores_a_late_ready_signal(tmp_path):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store, window_role="note", initial_note="Probe.md")
    child = Window()
    failed = []
    timer = _show_window_when_ready(child, bridge, lambda: failed.append(True), 30)
    try:
        assert bridge.window_failed("navigation") is True
        bridge.window_ready("Probe.md")
        assert child.shown == 0
        assert failed == [True]
        assert bridge.window_failed("navigation") is False
    finally:
        timer.cancel()


def test_closed_loading_window_cancels_timeout_and_late_reveal(tmp_path):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store, window_role="note", initial_note="Probe.md")
    child = Window()
    failed = []
    timer = _show_window_when_ready(child, bridge, lambda: failed.append(True), 30)
    child.destroy()
    bridge.window_ready("Probe.md")
    timer.function()
    assert child.shown == 0
    assert failed == []
    assert timer.finished.is_set()


def test_window_ready_rejects_the_wrong_note(tmp_path):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store, window_role="note", initial_note="Expected.md")
    shown = []
    bridge._set_window_ready_callback(lambda: shown.append(True))
    with pytest.raises(UserVisibleError):
        bridge.window_ready("Wrong.md")
    assert shown == []
    bridge.window_ready("Expected.md")
    assert shown == [True]


def test_note_bootstrap_loads_only_the_requested_note(tmp_path, monkeypatch):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store, window_role="note", initial_note="Probe.md")
    bridge.create_note("Probe")
    monkeypatch.setattr(bridge, "_ordered_notes", lambda: pytest.fail("note startup must not read every note"))
    data = bridge.bootstrap()
    assert data["initial_note_data"]["name"] == "Probe.md"
    assert data["notes"] == []


def test_javascript_api_exposes_methods_without_business_object_graph(tmp_path):
    from desktop_notes.bridge import javascript_api

    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    api = javascript_api(DesktopBridge(store))
    public = {name: getattr(api, name) for name in dir(api) if not name.startswith("_")}
    assert "bootstrap" in public
    assert "window_ready" in public
    assert "attach_window" not in public
    assert all(callable(value) for value in public.values())
    assert not hasattr(api, "config_store")
    assert api.bootstrap()["window_role"] == "main"


def test_timeout_fails_once_and_cannot_later_show_a_window(tmp_path):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store, window_role="note", initial_note="Probe.md")
    child = Window()
    failed = []
    timer = _show_window_when_ready(child, bridge, lambda: failed.append(True), 30)
    timer.function()
    timer.cancel()
    bridge.window_ready("Probe.md")
    assert failed == [True]
    assert child.shown == 0


def test_timeout_is_not_blocked_by_an_in_progress_bootstrap(tmp_path):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store, window_role="note", initial_note="Probe.md")
    failed = threading.Event()
    timer = _show_window_when_ready(Window(), bridge, failed.set, 30)
    try:
        with bridge._lock:
            timeout_thread = threading.Thread(target=timer.function)
            timeout_thread.start()
            assert failed.wait(1), "bootstrap must not block timeout and failure handling"
        timeout_thread.join(1)
    finally:
        timer.cancel()


def test_failed_open_releases_ownership_so_the_same_note_can_retry(tmp_path, monkeypatch):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    coordinator = WindowCoordinator(store)
    coordinator.register(WindowSession("main", "main", Window(), SimpleNamespace()))
    coordinator._main_visible = True
    attempts = []
    timers = []
    monkeypatch.setattr("desktop_notes.window_coordinator.focus_window", lambda window: window.show())

    def create(session_id, name, *_bounds):
        window = Window()
        bridge = DesktopBridge(store, coordinator, session_id=session_id, window_role="note", initial_note=name)
        coordinator.register(WindowSession(session_id, "note", window, bridge, name, loading=True))
        def failed():
            coordinator.close_session(session_id, forget_note=True)
            coordinator.unregister(session_id)
        timers.append(_show_window_when_ready(window, bridge, failed, 30, on_ready=lambda: coordinator.mark_ready(session_id)))
        attempts.append((window, bridge))

    coordinator.set_auxiliary_factory(create)
    try:
        coordinator.open_auxiliary("Probe.md")
        first_window, first_bridge = attempts[0]
        first_bridge.window_failed("navigation")
        assert first_window.destroyed == 1
        coordinator.open_auxiliary("Probe.md")
        second_window, second_bridge = attempts[1]
        first_bridge.window_ready("Probe.md")
        assert first_window.shown == 0
        second_bridge.window_ready("Probe.md")
        assert second_window.shown == 1
        coordinator.open_auxiliary("Probe.md")
        assert len(attempts) == 2
        assert second_window.shown == 2
    finally:
        for timer in timers:
            timer.cancel()


def test_failed_restored_note_reveals_manager_without_exiting_the_app(tmp_path):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    coordinator = WindowCoordinator(store)
    main_window = Window()
    coordinator.register(WindowSession("main", "main", main_window, SimpleNamespace()))
    child = Window()
    bridge = DesktopBridge(store, coordinator, session_id="note", window_role="note", initial_note="Probe.md")
    coordinator.register(WindowSession("note", "note", child, bridge, "Probe.md", loading=True))
    _handle_auxiliary_load_failure(coordinator, main_window, "note")
    assert main_window.shown == 1
    assert main_window.destroyed == 0
    assert child.destroyed == 1
    assert coordinator.note_name("note") is None


def test_startup_update_preference_accepts_malformed_json_objects(tmp_path, monkeypatch):
    import json
    from desktop_notes import main
    path = tmp_path / "config.json"
    path.write_text(json.dumps([]), encoding="utf-8")
    monkeypatch.setattr(main, "local_config_path", lambda: path)
    assert main._auto_update_enabled_on_startup() is True
