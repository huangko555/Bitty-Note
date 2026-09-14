from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from desktop_notes import updates
from desktop_notes.config import ConfigStore
from desktop_notes.errors import UserVisibleError


class FakeManager:
    checks = 0
    downloads = 0
    restarts = 0

    def __init__(self, _source: object):
        self.info = SimpleNamespace(
            TargetFullRelease=SimpleNamespace(Version="1.1.0")
        )

    def check_for_updates(self) -> object:
        type(self).checks += 1
        return self.info

    def get_update_pending_restart(self) -> None:
        return None

    def download_updates(self, _info: object) -> None:
        type(self).downloads += 1

    def apply_updates_and_restart(self, _info: object) -> None:
        type(self).restarts += 1


def make_store(tmp_path: Path) -> ConfigStore:
    return ConfigStore(tmp_path / "config.json", tmp_path / "notes")


class FakeRuntime:
    def __init__(self, *, saved: bool = True, invisible: bool = False) -> None:
        self.saved = saved
        self.invisible = invisible
        self.prepared: list[bool] = []
        self.notifications = 0

    def update_restart_state(self) -> updates.UpdateRestartState:
        return updates.UpdateRestartState(self.saved, self.invisible)

    def prepare_update_restart(self, allow_visible: bool) -> bool:
        self.prepared.append(allow_visible)
        return self.saved and (allow_visible or self.invisible)

    def notify_update_state_changed(self) -> None:
        self.notifications += 1


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_store_package_uses_microsoft_store_updates(
    tmp_path: Path, monkeypatch: object
) -> None:
    opened: list[bool] = []
    monkeypatch.setattr(updates, "open_store_updates", lambda: opened.append(True))
    service = updates.UpdateService(make_store(tmp_path), store_package=True)

    assert service.check(force=True) == {
        "status": "store",
        "available_version": None,
        "auto_update": False,
    }
    assert service.install()["status"] == "store"
    assert opened == [True]


def test_update_check_is_cached_for_one_day(
    tmp_path: Path, monkeypatch: object
) -> None:
    FakeManager.checks = 0
    sources: list[str] = []
    monkeypatch.setattr(
        updates.velopack,
        "HttpSource",
        lambda url: sources.append(url) or object(),
    )
    monkeypatch.setattr(updates.velopack, "UpdateManager", FakeManager)
    service = updates.UpdateService(make_store(tmp_path))

    first = service.check()
    second = service.check()

    assert first == {
        "status": "available",
        "available_version": "1.1.0",
        "auto_update": True,
    }
    assert second == first
    assert FakeManager.checks == 1
    assert sources == [
        "https://github.com/huangko555/Bitty-Note/releases/latest/download"
    ]


def test_install_downloads_and_hands_off_to_velopack(
    tmp_path: Path, monkeypatch: object
) -> None:
    FakeManager.checks = FakeManager.downloads = FakeManager.restarts = 0
    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", FakeManager)
    store = make_store(tmp_path)
    service = updates.UpdateService(store)

    service.install()

    assert FakeManager.downloads == 1
    assert FakeManager.restarts == 1
    assert store.config.pending_update_version == "1.1.0"


def test_unpackaged_build_reports_update_as_unsupported(
    tmp_path: Path, monkeypatch: object
) -> None:
    def fail(_source: object) -> object:
        raise RuntimeError("This application is not properly installed")

    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", fail)

    assert updates.UpdateService(make_store(tmp_path)).check() == {
        "status": "unsupported",
        "available_version": None,
        "auto_update": False,
    }


def test_check_failure_has_check_specific_message(
    tmp_path: Path, monkeypatch: object
) -> None:
    class CheckFailingManager(FakeManager):
        def check_for_updates(self) -> object:
            raise OSError("network unavailable")

    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", CheckFailingManager)

    with pytest.raises(UserVisibleError, match="Couldn't check for updates"):
        updates.UpdateService(make_store(tmp_path)).check(force=True)


def test_download_failure_has_install_specific_message(
    tmp_path: Path, monkeypatch: object
) -> None:
    class DownloadFailingManager(FakeManager):
        def download_updates(self, _info: object) -> None:
            raise OSError("download unavailable")

    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", DownloadFailingManager)
    store = make_store(tmp_path)

    with pytest.raises(UserVisibleError, match="Automatic update failed"):
        updates.UpdateService(store).install()

    assert store.config.pending_update_version is None


def test_automatic_update_installs_after_session_is_locked_for_two_minutes(
    tmp_path: Path, monkeypatch: object
) -> None:
    FakeManager.checks = FakeManager.downloads = FakeManager.restarts = 0
    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", FakeManager)
    runtime = FakeRuntime(saved=True, invisible=False)
    clock = FakeClock()
    service = updates.UpdateService(
        make_store(tmp_path),
        runtime=runtime,
        session_locked=lambda: True,
        clock=clock,
    )

    service.maintain()
    clock.advance(updates.LOCKED_INSTALL_DELAY_SECONDS - 1)
    service.maintain()
    assert FakeManager.restarts == 0

    clock.advance(1)
    service.maintain()

    assert FakeManager.downloads == 1
    assert FakeManager.restarts == 1
    assert runtime.prepared == [True]


def test_automatic_update_installs_after_every_window_is_invisible_for_thirty_minutes(
    tmp_path: Path, monkeypatch: object
) -> None:
    FakeManager.checks = FakeManager.downloads = FakeManager.restarts = 0
    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", FakeManager)
    runtime = FakeRuntime(saved=True, invisible=True)
    clock = FakeClock()
    service = updates.UpdateService(make_store(tmp_path), runtime=runtime, clock=clock)

    service.maintain()
    clock.advance(updates.INVISIBLE_INSTALL_DELAY_SECONDS)
    service.maintain()

    assert FakeManager.restarts == 1
    assert runtime.prepared == [False]


def test_visible_unlocked_windows_never_trigger_automatic_restart(
    tmp_path: Path, monkeypatch: object
) -> None:
    FakeManager.checks = FakeManager.downloads = FakeManager.restarts = 0
    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", FakeManager)
    runtime = FakeRuntime(saved=True, invisible=False)
    clock = FakeClock()
    service = updates.UpdateService(make_store(tmp_path), runtime=runtime, clock=clock)

    service.maintain()
    clock.advance(24 * 60 * 60)
    service.maintain()

    assert FakeManager.downloads == 1
    assert FakeManager.restarts == 0
    assert runtime.prepared == []


def test_disabling_automatic_updates_prevents_checks_and_downloads(
    tmp_path: Path, monkeypatch: object
) -> None:
    FakeManager.checks = FakeManager.downloads = FakeManager.restarts = 0
    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", FakeManager)
    store = make_store(tmp_path)
    service = updates.UpdateService(store, runtime=FakeRuntime())

    assert service.set_auto_update(False) == {"enabled": False}
    service.maintain()

    assert store.config.auto_update is False
    assert FakeManager.checks == 0
    assert FakeManager.downloads == 0


def test_automatic_download_failure_marks_the_version_and_notifies_windows(
    tmp_path: Path, monkeypatch: object
) -> None:
    class DownloadFailingManager(FakeManager):
        def download_updates(self, _info: object) -> None:
            raise OSError("download unavailable")

    monkeypatch.setattr(updates.velopack, "HttpSource", lambda _url: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", DownloadFailingManager)
    runtime = FakeRuntime()
    service = updates.UpdateService(make_store(tmp_path), runtime=runtime)

    service.maintain()

    assert service.state() == {
        "status": "error",
        "available_version": "1.1.0",
        "auto_update": True,
    }
    assert runtime.notifications == 1
