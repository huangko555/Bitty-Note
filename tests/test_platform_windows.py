from __future__ import annotations

import os
from pathlib import Path

import pytest

from desktop_notes import platform_windows
from desktop_notes.errors import UserVisibleError


class _FakeEvent:
    def __init__(self) -> None:
        self.handlers: list[object] = []

    def __iadd__(self, handler: object) -> "_FakeEvent":
        self.handlers.append(handler)
        return self


class _FakeWebViewCore:
    def __init__(self) -> None:
        self.ProcessFailed = _FakeEvent()
        self.reloads = 0

    def Reload(self) -> None:
        self.reloads += 1


class _FakeWebViewControl:
    def __init__(self) -> None:
        self.CoreWebView2 = _FakeWebViewCore()
        self.invalidations = 0
        self.updates = 0

    def Invalidate(self) -> None:
        self.invalidations += 1

    def Update(self) -> None:
        self.updates += 1


def _fake_webview_window() -> tuple[object, object, _FakeWebViewControl]:
    control = _FakeWebViewControl()
    native = type(
        "Native",
        (),
        {
            "Controls": [control],
            "Activated": _FakeEvent(),
            "InvokeRequired": False,
        },
    )()
    return type("Window", (), {"native": native})(), native, control


def test_window_is_on_screen_only_when_visible_and_not_minimized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeHandle:
        @staticmethod
        def ToInt64() -> int:
            return 123

    class FakeUser32:
        IsWindowVisible = staticmethod(lambda _handle: True)
        IsIconic = staticmethod(lambda _handle: False)

    window = type(
        "Window",
        (),
        {"native": type("Native", (), {"Handle": FakeHandle()})()},
    )()
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(
        platform_windows.ctypes,
        "windll",
        type("FakeWindll", (), {"user32": FakeUser32()})(),
    )

    assert platform_windows.is_window_on_screen(window) is True
    FakeUser32.IsIconic = staticmethod(lambda _handle: True)
    assert platform_windows.is_window_on_screen(window) is False
    FakeUser32.IsIconic = staticmethod(lambda _handle: False)
    FakeUser32.IsWindowVisible = staticmethod(lambda _handle: False)
    assert platform_windows.is_window_on_screen(window) is False


def test_session_lock_probe_fails_closed_when_state_is_uncertain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(
        platform_windows.ctypes,
        "WinDLL",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("unavailable")),
    )

    assert platform_windows.is_session_locked() is False


def test_window_interaction_scales_the_shared_minimum_for_dpi(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeFunction:
        argtypes: object = None
        restype: object = None

        def __init__(self, callback: object) -> None:
            self.callback = callback

        def __call__(self, *args: object) -> object:
            return self.callback(*args)  # type: ignore[operator]

    class FakeHandle:
        @staticmethod
        def ToInt64() -> int:
            return 123

    class FakeUser32:
        @staticmethod
        def _get_cursor(pointer: object) -> bool:
            pointer._obj.x = 100  # type: ignore[attr-defined]
            pointer._obj.y = 120  # type: ignore[attr-defined]
            return True

        @staticmethod
        def _get_rect(_handle: int, pointer: object) -> bool:
            pointer._obj.left = 20  # type: ignore[attr-defined]
            pointer._obj.top = 30  # type: ignore[attr-defined]
            pointer._obj.right = 620  # type: ignore[attr-defined]
            pointer._obj.bottom = 730  # type: ignore[attr-defined]
            return True

        GetCursorPos = FakeFunction(_get_cursor)
        GetWindowRect = FakeFunction(_get_rect)
        GetDpiForWindow = FakeFunction(lambda _handle: 144)

    window = type(
        "Window",
        (),
        {"native": type("Native", (), {"Handle": FakeHandle()})()},
    )()
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(
        platform_windows.ctypes,
        "windll",
        type("FakeWindll", (), {"user32": FakeUser32()})(),
    )

    interaction = platform_windows.start_window_interaction(window, "bottom_right")

    assert interaction.min_width == 450
    assert interaction.min_height == 570


def test_window_interaction_does_not_move_after_left_button_is_released(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []

    class FakeFunction:
        argtypes: object = None
        restype: object = None

        def __init__(self, callback: object) -> None:
            self.callback = callback

        def __call__(self, *args: object) -> object:
            return self.callback(*args)  # type: ignore[operator]

    class FakeUser32:
        GetAsyncKeyState = FakeFunction(lambda _key: 0)

        @staticmethod
        def _get_cursor(pointer: object) -> bool:
            pointer._obj.x = 180  # type: ignore[attr-defined]
            pointer._obj.y = 160  # type: ignore[attr-defined]
            return True

        GetCursorPos = FakeFunction(_get_cursor)
        SetWindowPos = FakeFunction(lambda *args: calls.append(args) or True)

    interaction = platform_windows.WindowInteraction(
        region="caption",
        handle=123,
        cursor_x=100,
        cursor_y=100,
        left=20,
        top=30,
        right=320,
        bottom=410,
        min_width=300,
        min_height=380,
    )
    monkeypatch.setattr(
        platform_windows.ctypes,
        "windll",
        type("FakeWindll", (), {"user32": FakeUser32()})(),
    )

    platform_windows.update_window_interaction(interaction)

    assert calls == []


def test_enable_taskbar_minimize_adds_required_native_styles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeHandle:
        @staticmethod
        def ToInt64() -> int:
            return 123

    window = type("Window", (), {"native": type("Native", (), {"Handle": FakeHandle()})()})()
    written: list[tuple[int, int]] = []
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(platform_windows, "_get_window_style", lambda _handle: 0x10000000)
    monkeypatch.setattr(
        platform_windows,
        "_set_window_style",
        lambda handle, style: written.append((handle, style)),
    )

    platform_windows.enable_taskbar_minimize(window)

    assert written == [(123, 0x100A0000)]


def test_hidden_window_resize_does_not_request_window_show(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, ...]] = []

    class FakeFunction:
        argtypes: object = None
        restype: object = None

        def __init__(self, callback: object) -> None:
            self.callback = callback

        def __call__(self, *args: object) -> object:
            return self.callback(*args)  # type: ignore[operator]

    class FakeHandle:
        @staticmethod
        def ToInt64() -> int:
            return 123

    class FakeUser32:
        GetDpiForWindow = FakeFunction(lambda _handle: 144)
        SetWindowPos = FakeFunction(lambda *args: calls.append(args) or True)

    window = type(
        "Window",
        (),
        {"native": type("Native", (), {"Handle": FakeHandle()})()},
    )()
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(
        platform_windows.ctypes,
        "windll",
        type("FakeWindll", (), {"user32": FakeUser32()})(),
    )

    platform_windows.resize_window_without_showing(window, 350, 630)

    assert calls == [(123, None, 0, 0, 525, 945, 0x0016)]
    assert calls[0][-1] & 0x0040 == 0  # SWP_SHOWWINDOW must stay absent.
    assert FakeUser32.GetDpiForWindow.argtypes == [platform_windows.ctypes.wintypes.HWND]
    assert FakeUser32.GetDpiForWindow.restype is platform_windows.ctypes.wintypes.UINT


def test_webview_recovery_reloads_an_exited_main_renderer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    window, _native, control = _fake_webview_window()
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")

    assert platform_windows.install_webview_recovery(window) is True
    assert len(control.CoreWebView2.ProcessFailed.handlers) == 1

    args = type(
        "Failure",
        (),
        {"ProcessFailedKind": "RenderProcessExited", "Reason": "Crashed"},
    )()
    control.CoreWebView2.ProcessFailed.handlers[0](control.CoreWebView2, args)

    assert control.CoreWebView2.reloads == 1


def test_webview_surface_is_refreshed_when_window_is_activated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    window, native, control = _fake_webview_window()
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")

    assert platform_windows.install_webview_recovery(window) is True
    assert len(native.Activated.handlers) == 1

    native.Activated.handlers[0](native, object())

    assert control.invalidations == 1
    assert control.updates == 1


def test_webview_recovery_is_installed_once_and_ignores_subframe_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    window, native, control = _fake_webview_window()
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")

    assert platform_windows.install_webview_recovery(window) is True
    assert platform_windows.install_webview_recovery(window) is True
    assert len(control.CoreWebView2.ProcessFailed.handlers) == 1
    assert len(native.Activated.handlers) == 1

    args = type(
        "Failure",
        (),
        {
            "ProcessFailedKind": "CoreWebView2ProcessFailedKind.FrameRenderProcessExited",
            "Reason": "Crashed",
        },
    )()
    control.CoreWebView2.ProcessFailed.handlers[0](control.CoreWebView2, args)

    assert control.CoreWebView2.reloads == 0


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


def test_open_file_uses_the_windows_default_app(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    note = tmp_path / "Note.md"
    note.write_text("body", encoding="utf-8")
    opened: list[str] = []
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(os, "startfile", opened.append, raising=False)

    platform_windows.open_file(note)

    assert opened == [str(note.resolve())]


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
        "QueryValueEx",
        lambda *_args: (_ for _ in ()).throw(FileNotFoundError()),
    )
    monkeypatch.setattr(
        winreg,
        "DeleteValue",
        lambda *_args: (_ for _ in ()).throw(FileNotFoundError()),
    )

    platform_windows.set_autostart(True)

    assert written == [("Bitty", '"C:\\Program Files\\Bitty\\小记一下.exe"')]


def test_autostart_does_not_rewrite_an_unchanged_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    winreg = pytest.importorskip("winreg")
    written: list[str] = []

    class FakeKey:
        def __enter__(self) -> "FakeKey":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    command = r'"C:\Program Files\Bitty\Bitty.exe"'
    monkeypatch.setattr(platform_windows.sys, "platform", "win32")
    monkeypatch.setattr(platform_windows.sys, "frozen", True, raising=False)
    monkeypatch.setattr(platform_windows.sys, "executable", command[1:-1])
    monkeypatch.setattr(winreg, "OpenKey", lambda *_args: FakeKey())
    monkeypatch.setattr(winreg, "QueryValueEx", lambda *_args: (command, winreg.REG_SZ))
    monkeypatch.setattr(
        winreg,
        "SetValueEx",
        lambda _key, _name, _reserved, _kind, value: written.append(value),
    )
    monkeypatch.setattr(
        winreg,
        "DeleteValue",
        lambda *_args: (_ for _ in ()).throw(FileNotFoundError()),
    )

    platform_windows.set_autostart(True)

    assert written == []
