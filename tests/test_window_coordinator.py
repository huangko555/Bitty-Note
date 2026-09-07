from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from desktop_notes.config import ConfigStore
from desktop_notes.i18n import set_language
from desktop_notes.window_coordinator import WindowCoordinator, WindowSession


class FakeNativeWindow:
    def __init__(self) -> None:
        self.activated = 0

    def Activate(self) -> None:
        self.activated += 1


class FakeWindow:
    def __init__(self, x: int = 100, y: int = 80) -> None:
        self.x = x
        self.y = y
        self.width = 350
        self.height = 530
        self.titles: list[str] = []
        self.restored = 0
        self.destroyed = 0
        self.scripts: list[str] = []
        self.native = FakeNativeWindow()

    def set_title(self, title: str) -> None:
        self.titles.append(title)

    def restore(self) -> None:
        self.restored += 1

    def destroy(self) -> None:
        self.destroyed += 1

    def run_js(self, script: str) -> None:
        self.scripts.append(script)


class FakeBridge:
    allow_close = False


def coordinator(tmp_path: Path) -> tuple[WindowCoordinator, FakeWindow]:
    set_language("en")
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    result = WindowCoordinator(store)
    main_window = FakeWindow()
    result.register(WindowSession("main", "main", main_window, FakeBridge()))
    return result, main_window


def test_taskbar_titles_only_name_main_note_when_multiple_notes_are_open(
    tmp_path: Path,
) -> None:
    windows, main_window = coordinator(tmp_path)
    assert windows.acquire_note("main", "Shopping.md") is True
    assert main_window.titles[-1] == "Bitty"

    auxiliary_window = FakeWindow()
    auxiliary_ids: list[str] = []

    def create_auxiliary(
        session_id: str,
        name: str,
        _width: int,
        _height: int,
        _x: int,
        _y: int,
        _position_space: str | None,
    ) -> None:
        auxiliary_ids.append(session_id)
        windows.register(WindowSession(
            session_id, "note", auxiliary_window, FakeBridge(), name
        ))

    windows.set_auxiliary_factory(create_auxiliary)
    assert windows.open_auxiliary("Travel.md") == {"status": "opened"}
    assert main_window.titles[-1] == "Shopping"
    assert auxiliary_window.titles[-1] == "Travel"

    windows.unregister(auxiliary_ids[0])
    assert main_window.titles[-1] == "Bitty"


def test_opening_the_same_note_focuses_existing_window(tmp_path: Path) -> None:
    windows, _main_window = coordinator(tmp_path)
    auxiliary_window = FakeWindow()
    created = 0

    def create_auxiliary(
        session_id: str,
        name: str,
        _width: int,
        _height: int,
        _x: int,
        _y: int,
        _position_space: str | None,
    ) -> None:
        nonlocal created
        created += 1
        windows.register(WindowSession(
            session_id, "note", auxiliary_window, FakeBridge(), name
        ))

    windows.set_auxiliary_factory(create_auxiliary)
    assert windows.open_auxiliary("Travel.md") == {"status": "opened"}
    assert windows.open_auxiliary("travel.MD") == {"status": "focused"}
    assert created == 1
    assert auxiliary_window.restored == 1


def test_restart_restores_every_open_note_window_with_its_bounds(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "notes")
    persisted = store.config.to_dict()
    persisted["open_note_windows"] = {
        "First.md": {"x": 120, "y": 80, "width": 410, "height": 610},
        "Second.md": {"x": 560, "y": 140, "width": 520, "height": 720},
    }
    config_path.write_text(json.dumps(persisted), encoding="utf-8")

    restarted_store = ConfigStore(config_path, tmp_path / "notes")
    windows = WindowCoordinator(restarted_store)
    windows.register(WindowSession("main", "main", FakeWindow(), FakeBridge()))
    created: list[tuple[str, int, int, int, int, str | None]] = []

    def create_auxiliary(
        session_id: str,
        name: str,
        width: int,
        height: int,
        x: int,
        y: int,
        position_space: str | None,
    ) -> None:
        created.append((name, width, height, x, y, position_space))
        windows.register(WindowSession(
            session_id, "note", FakeWindow(x, y), FakeBridge(), name
        ))

    windows.set_auxiliary_factory(create_auxiliary)

    assert windows.restore_auxiliaries(["First.md", "Second.md"]) == [
        "First.md",
        "Second.md",
    ]
    assert created == [
        ("First.md", 410, 610, 120, 80, "logical"),
        ("Second.md", 520, 720, 560, 140, "logical"),
    ]


def test_requesting_rename_focuses_open_note_and_starts_inline_edit(tmp_path: Path) -> None:
    windows, _main_window = coordinator(tmp_path)
    auxiliary_window = FakeWindow()
    windows.register(WindowSession(
        "auxiliary", "note", auxiliary_window, FakeBridge(), "Travel.md"
    ))

    assert windows.request_note_rename("travel.MD") == {"status": "focused"}
    assert auxiliary_window.restored == 1
    assert "window.desktopNotesBeginRename?.()" in auxiliary_window.scripts
    assert windows.request_note_rename("Other.md") == {"status": "available"}


def test_renaming_an_open_note_moves_its_window_size(tmp_path: Path) -> None:
    windows, _main_window = coordinator(tmp_path)
    assert windows.acquire_note("main", "Old.md") is True
    windows.save_size("Old.md", 480, 700)
    windows.save_window_state("Old.md", 120, 90, 480, 700)

    renamed = windows.rename_note(
        "main",
        "Old.md",
        "New",
        lambda: SimpleNamespace(name="New.md"),
    )

    assert renamed.name == "New.md"
    assert windows.note_name("main") == "New.md"
    assert windows.saved_size("New.md") == (480, 700)
    assert "Old.md" not in windows.config_store.config.note_window_sizes
    assert windows.config_store.config.open_note_windows == {
        "New.md": {"x": 120, "y": 90, "width": 480, "height": 700}
    }
    assert "window.desktopNotesRefreshHome?.()" in _main_window.scripts


def test_external_deletion_cleans_only_closed_note_sizes(tmp_path: Path) -> None:
    windows, _main_window = coordinator(tmp_path)
    windows.save_size("Open.md", 410, 610)
    windows.save_size("Deleted.md", 420, 620)
    windows.save_window_state("Deleted.md", 100, 100, 420, 620)
    assert windows.acquire_note("main", "Open.md") is True

    windows.reconcile_saved_sizes([])

    assert windows.saved_size("Open.md") == (410, 610)
    assert "Deleted.md" not in windows.config_store.config.note_window_sizes
    assert windows.config_store.config.open_note_windows == {}


def test_main_close_waits_for_auxiliary_window(tmp_path: Path) -> None:
    windows, main_window = coordinator(tmp_path)
    auxiliary_window = FakeWindow()
    auxiliary_bridge = FakeBridge()
    windows.register(WindowSession(
        "aux", "note", auxiliary_window, auxiliary_bridge, "Travel.md"
    ))
    windows.save_window_state("Travel.md", 240, 160, 430, 650)

    windows.close_session("main")
    assert main_window.destroyed == 0
    assert auxiliary_window.scripts == ["window.desktopNotesRequestClose?.()"]

    windows.unregister("aux")
    assert main_window.destroyed == 1
    assert windows.config_store.config.open_note_windows == {
        "Travel.md": {"x": 240, "y": 160, "width": 430, "height": 650}
    }


def test_closing_only_one_note_window_removes_it_from_next_startup(
    tmp_path: Path,
) -> None:
    windows, _main_window = coordinator(tmp_path)
    auxiliary_window = FakeWindow()
    class StateSaver:
        stopped = False

        def flush(self) -> None:
            if not self.stopped:
                windows.save_window_state("Travel.md", 250, 170, 440, 660)

        def stop(self) -> None:
            self.stopped = True

    state_saver = StateSaver()
    windows.register(WindowSession(
        "aux", "note", auxiliary_window, FakeBridge(), "Travel.md", state_saver
    ))
    windows.save_window_state("Travel.md", 240, 160, 430, 650)

    windows.close_session("aux")
    state_saver.flush()

    assert auxiliary_window.destroyed == 1
    assert state_saver.stopped is True
    assert windows.config_store.config.open_note_windows == {}


def test_failed_auxiliary_save_cancels_main_close(tmp_path: Path) -> None:
    windows, main_window = coordinator(tmp_path)
    auxiliary_window = FakeWindow()
    windows.register(WindowSession(
        "aux", "note", auxiliary_window, FakeBridge(), "Travel.md"
    ))
    windows.save_window_state("Travel.md", 240, 160, 430, 650)

    windows.close_session("main")
    windows.cancel_app_close()
    windows.unregister("aux")

    assert main_window.destroyed == 0
    assert windows.config_store.config.open_note_windows == {}
