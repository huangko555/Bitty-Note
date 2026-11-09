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
    failed = threading.Event()
    timer = _show_window_when_ready(child, bridge, failed.set, 30)
    try:
        assert bridge.window_failed("navigation") is True
        bridge.window_ready("Probe.md")
        assert child.shown == 0
        assert failed.wait(1)
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
    failed = threading.Event()
    timer = _show_window_when_ready(child, bridge, failed.set, 30)
    timer.function()
    timer.cancel()
    bridge.window_ready("Probe.md")
    assert failed.wait(1)
    assert bridge.window_failed("timeout") is False
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
    failure_handled = threading.Event()
    monkeypatch.setattr("desktop_notes.window_coordinator.focus_window", lambda window: window.show())

    def create(session_id, name, *_bounds):
        window = Window()
        bridge = DesktopBridge(store, coordinator, session_id=session_id, window_role="note", initial_note=name)
        coordinator.register(WindowSession(session_id, "note", window, bridge, name, loading=True))
        def failed():
            coordinator.close_session(session_id, forget_note=True)
            coordinator.unregister(session_id)
            failure_handled.set()
        timers.append(_show_window_when_ready(window, bridge, failed, 30, on_ready=lambda: coordinator.mark_ready(session_id)))
        attempts.append((window, bridge))

    coordinator.set_auxiliary_factory(create)
    try:
        coordinator.open_auxiliary("Probe.md")
        first_window, first_bridge = attempts[0]
        first_bridge.window_failed("navigation")
        assert failure_handled.wait(1)
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


@pytest.mark.parametrize("operation", ["rename_note", "archive_note", "trash_note"])
def test_home_cannot_mutate_a_note_while_its_window_is_being_created(tmp_path, monkeypatch, operation):
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    coordinator = WindowCoordinator(store)
    coordinator.register(WindowSession("main", "main", Window(), SimpleNamespace()))
    bridge = DesktopBridge(store, coordinator)
    bridge.create_note("Pending")
    creating = threading.Event()
    finish_creating = threading.Event()
    errors = []
    monkeypatch.setattr("desktop_notes.bridge.send_file_to_trash", lambda _path: None)

    def create(session_id, name, *_bounds):
        creating.set()
        assert finish_creating.wait(2)
        coordinator.register(WindowSession(session_id, "note", Window(), SimpleNamespace(), name))

    def open_window():
        try:
            bridge.open_note_window("Pending.md")
        except Exception as error:
            errors.append(error)

    coordinator.set_auxiliary_factory(create)
    worker = threading.Thread(target=open_window, daemon=True)
    worker.start()
    try:
        assert creating.wait(1)
        args = ("Pending.md", "Renamed") if operation == "rename_note" else ("Pending.md",)
        with pytest.raises(UserVisibleError):
            getattr(bridge, operation)(*args)
        assert bridge.open_note("Pending.md")["name"] == "Pending.md"
    finally:
        finish_creating.set()
        worker.join(2)
    assert not worker.is_alive()
    assert errors == []


@pytest.mark.parametrize("stage", ["webview", "navigation", "renderer"])
def test_failed_copied_note_does_not_block_the_native_ui_thread(tmp_path, monkeypatch, stage):
    from desktop_notes import platform_windows

    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    coordinator = WindowCoordinator(store)
    ui_available = threading.Event()
    handler_returned = threading.Event()
    recovery_finished = threading.Event()

    class MainWindow(Window):
        def run_js(self, _script):
            # pywebview waits for ExecuteScriptAsync to finish on the native UI thread.
            ui_available.wait(2)

    main_window = MainWindow()
    coordinator.register(WindowSession("main", "main", main_window, SimpleNamespace()))
    coordinator.register(WindowSession("original", "note", Window(), SimpleNamespace(), "Original.md"))
    bridge = DesktopBridge(store, coordinator)
    bridge.create_note("Original")
    copied = bridge.duplicate_note("Original.md", "Copy")
    handlers = {}
    timers = []

    def create(session_id, name, *_bounds):
        child = Window()
        control = SimpleNamespace(
            CoreWebView2=SimpleNamespace(ProcessFailed=Event()),
            CoreWebView2InitializationCompleted=Event(),
            NavigationCompleted=Event(),
        )
        if stage == "webview":
            control.CoreWebView2 = None
        child.native = SimpleNamespace(
            Controls=[control], InvokeRequired=False, Activated=Event(),
        )
        child_bridge = DesktopBridge(
            store, coordinator, session_id=session_id, window_role="note", initial_note=name,
        )
        coordinator.register(WindowSession(
            session_id, "note", child, child_bridge, name, loading=True,
        ))

        def failed():
            try:
                _handle_auxiliary_load_failure(coordinator, main_window, session_id)
            finally:
                recovery_finished.set()

        timers.append(_show_window_when_ready(child, child_bridge, failed, 30))
        assert platform_windows.install_webview_recovery(child, child_bridge.window_failed)
        handlers["webview"] = control.CoreWebView2InitializationCompleted
        handlers["navigation"] = control.NavigationCompleted
        if control.CoreWebView2 is not None:
            handlers["renderer"] = control.CoreWebView2.ProcessFailed

    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    coordinator.set_auxiliary_factory(create)
    assert bridge.open_note_window(copied["name"]) == {"status": "opened"}

    def dispatch_native_event():
        args = SimpleNamespace(
            IsSuccess=False, ProcessFailedKind="RenderProcessExited", Reason="Crashed",
        )
        for handler in handlers[stage].handlers:
            handler(None, args)
        handler_returned.set()
        ui_available.set()

    ui_thread = threading.Thread(target=dispatch_native_event, daemon=True)
    ui_thread.start()
    try:
        assert handler_returned.wait(0.5), "Opening the copied note froze the native UI during startup recovery"
        assert recovery_finished.wait(1)
        assert coordinator.note_name("original") == "Original.md"
        assert main_window.destroyed == 0
        assert coordinator.open_auxiliary(copied["name"])["status"] == "opened"
    finally:
        ui_available.set()
        ui_thread.join(2)
        for timer in timers:
            timer.cancel()


def test_startup_update_preference_accepts_malformed_json_objects(tmp_path, monkeypatch):
    import json
    from desktop_notes import main
    path = tmp_path / "config.json"
    path.write_text(json.dumps([]), encoding="utf-8")
    monkeypatch.setattr(main, "local_config_path", lambda: path)
    assert main._auto_update_enabled_on_startup() is True
