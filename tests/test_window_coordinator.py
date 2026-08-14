from __future__ import annotations

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
    assert "window.desktopNotesRefreshHome?.()" in _main_window.scripts


def test_external_deletion_cleans_only_closed_note_sizes(tmp_path: Path) -> None:
    windows, _main_window = coordinator(tmp_path)
    windows.save_size("Open.md", 410, 610)
    windows.save_size("Deleted.md", 420, 620)
    assert windows.acquire_note("main", "Open.md") is True

    windows.reconcile_saved_sizes([])

    assert windows.saved_size("Open.md") == (410, 610)
    assert "Deleted.md" not in windows.config_store.config.note_window_sizes


def test_main_close_waits_for_auxiliary_window(tmp_path: Path) -> None:
    windows, main_window = coordinator(tmp_path)
    auxiliary_window = FakeWindow()
    auxiliary_bridge = FakeBridge()
    windows.register(WindowSession(
        "aux", "note", auxiliary_window, auxiliary_bridge, "Travel.md"
    ))

    windows.close_session("main")
    assert main_window.destroyed == 0
    assert auxiliary_window.scripts == ["window.desktopNotesRequestClose?.()"]

    windows.unregister("aux")
    assert main_window.destroyed == 1


def test_failed_auxiliary_save_cancels_main_close(tmp_path: Path) -> None:
    windows, main_window = coordinator(tmp_path)
    auxiliary_window = FakeWindow()
    windows.register(WindowSession(
        "aux", "note", auxiliary_window, FakeBridge(), "Travel.md"
    ))

    windows.close_session("main")
    windows.cancel_app_close()
    windows.unregister("aux")

    assert main_window.destroyed == 0
