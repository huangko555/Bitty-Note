from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from desktop_notes import updates
from desktop_notes.config import ConfigStore


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

    def download_updates(self, _info: object) -> None:
        type(self).downloads += 1

    def apply_updates_and_restart(self, _info: object) -> None:
        type(self).restarts += 1


def make_store(tmp_path: Path) -> ConfigStore:
    return ConfigStore(tmp_path / "config.json", tmp_path / "notes")


def test_store_package_uses_microsoft_store_updates(
    tmp_path: Path, monkeypatch: object
) -> None:
    opened: list[bool] = []
    monkeypatch.setattr(updates, "open_store_updates", lambda: opened.append(True))
    service = updates.UpdateService(make_store(tmp_path), store_package=True)

    assert service.check(force=True) == {
        "status": "store",
        "available_version": None,
    }
    assert service.install()["status"] == "store"
    assert opened == [True]


def test_update_check_is_cached_for_one_day(
    tmp_path: Path, monkeypatch: object
) -> None:
    FakeManager.checks = 0
    monkeypatch.setattr(updates.velopack, "GithubSource", lambda *_args: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", FakeManager)
    service = updates.UpdateService(make_store(tmp_path))

    first = service.check()
    second = service.check()

    assert first == {"status": "available", "available_version": "1.1.0"}
    assert second == first
    assert FakeManager.checks == 1


def test_install_downloads_and_hands_off_to_velopack(
    tmp_path: Path, monkeypatch: object
) -> None:
    FakeManager.checks = FakeManager.downloads = FakeManager.restarts = 0
    monkeypatch.setattr(updates.velopack, "GithubSource", lambda *_args: object())
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

    monkeypatch.setattr(updates.velopack, "GithubSource", lambda *_args: object())
    monkeypatch.setattr(updates.velopack, "UpdateManager", fail)

    assert updates.UpdateService(make_store(tmp_path)).check() == {
        "status": "unsupported",
        "available_version": None,
    }
