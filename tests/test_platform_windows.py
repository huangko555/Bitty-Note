from __future__ import annotations

import os
from pathlib import Path

import pytest

from desktop_notes import platform_windows
from desktop_notes.errors import UserVisibleError


def test_open_directory_uses_windows_shell(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(os, "startfile", opened.append, raising=False)

    platform_windows.open_directory(tmp_path)

    assert opened == [str(tmp_path.resolve())]


def test_open_directory_rejects_missing_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")

    with pytest.raises(UserVisibleError, match="storage folder doesn't exist"):
        platform_windows.open_directory(tmp_path / "missing")


def test_frozen_autostart_command_uses_windows_double_quotes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    winreg = pytest.importorskip("winreg")
    written: list[tuple[str, str]] = []

    class FakeKey:
        def __enter__(self) -> "FakeKey":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(platform_windows.sys, "frozen", True, raising=False)
    monkeypatch.setattr(
        platform_windows.sys,
        "executable",
        r"C:\Program Files\Bitty\小记一下.exe",
    )
    monkeypatch.setattr(winreg, "OpenKey", lambda *_args: FakeKey())
    monkeypatch.setattr(
        winreg,
        "SetValueEx",
        lambda _key, name, _reserved, _kind, value: written.append((name, value)),
    )
    monkeypatch.setattr(
        winreg,
        "DeleteValue",
        lambda *_args: (_ for _ in ()).throw(FileNotFoundError()),
    )

    platform_windows.set_autostart(True)

    assert written == [("Bitty", '"C:\\Program Files\\Bitty\\小记一下.exe"')]
