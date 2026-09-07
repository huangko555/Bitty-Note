from __future__ import annotations

import logging
import re
import threading
import uuid
from dataclasses import dataclass
from typing import Any, Callable

from .config import ConfigStore
from .errors import UserVisibleError
from .i18n import text
from .platform_windows import focus_window


AuxiliaryFactory = Callable[
    [str, str, int, int, int, int, str | None],
    None,
]


@dataclass
class WindowSession:
    session_id: str
    role: str
    window: Any
    bridge: Any
    note_name: str | None = None
    state_saver: Any = None


class WindowCoordinator:
    """Owns cross-window invariants while each webview keeps its own UI state."""

    def __init__(self, config_store: ConfigStore):
        self.config_store = config_store
        self._sessions: dict[str, WindowSession] = {}
        self._note_owners: dict[str, str] = {}
        self._reservations: dict[str, str] = {}
        self._create_auxiliary: AuxiliaryFactory | None = None
        self._lock = threading.RLock()
        self._main_close_pending = False
        self._cascade_index = 0

    def set_auxiliary_factory(
        self,
        factory: AuxiliaryFactory,
    ) -> None:
        self._create_auxiliary = factory

    def register(self, session: WindowSession, *, refresh_titles: bool = True) -> None:
        with self._lock:
            self._sessions[session.session_id] = session
            if session.note_name:
                key = self._key(session.note_name)
                self._reservations.pop(key, None)
                self._note_owners[key] = session.session_id
        if refresh_titles:
            self.refresh_titles()

    def unregister(self, session_id: str) -> None:
        close_main: WindowSession | None = None
        with self._lock:
            session = self._sessions.pop(session_id, None)
            if session and session.note_name:
                self._note_owners.pop(self._key(session.note_name), None)
                if session.role != "main" and not self._main_close_pending:
                    self._remove_open_window_locked(session.note_name)
            if self._main_close_pending and not self._auxiliary_sessions_locked():
                close_main = self._main_session_locked()
                self._main_close_pending = False
        self.refresh_titles()
        if close_main is not None:
            close_main.bridge.allow_close = True
            close_main.window.destroy()

    def acquire_note(self, session_id: str, name: str) -> bool:
        focus: WindowSession | None = None
        with self._lock:
            key = self._key(name)
            session = self._sessions.get(session_id)
            if session is None and self._reservations.get(key) == session_id:
                return True
            if session is None:
                raise RuntimeError("Window session is not registered")
            owner_id = self._note_owners.get(key)
            if owner_id is not None and owner_id != session_id:
                focus = self._sessions.get(owner_id)
            else:
                if session.note_name:
                    self._note_owners.pop(self._key(session.note_name), None)
                session.note_name = name
                self._note_owners[key] = session_id
        if focus is not None:
            self._focus(focus)
            return False
        self.refresh_titles()
        return True

    def release_note(self, session_id: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.note_name is None or session.role != "main":
                return
            self._note_owners.pop(self._key(session.note_name), None)
            session.note_name = None
        self.refresh_titles()

    def open_auxiliary(self, name: str) -> dict[str, str]:
        return self._open_auxiliary(name)

    def restore_auxiliaries(self, existing_names: list[str]) -> list[str]:
        existing_by_key = {self._key(name): name for name in existing_names}
        with self._lock:
            saved_windows = dict(self.config_store.config.open_note_windows)
        restored: list[str] = []
        for stored_name, bounds in saved_windows.items():
            name = existing_by_key.get(self._key(stored_name))
            if name is None:
                continue
            try:
                result = self._open_auxiliary(
                    name,
                    (
                        bounds["width"],
                        bounds["height"],
                        bounds["x"],
                        bounds["y"],
                        "logical",
                    ),
                )
            except Exception:
                logging.exception("Failed to restore note window %s.", name)
                continue
            if result["status"] == "opened":
                restored.append(name)
        return restored

    def _open_auxiliary(
        self,
        name: str,
        restored_bounds: tuple[int, int, int, int, str | None] | None = None,
    ) -> dict[str, str]:
        factory = self._create_auxiliary
        if factory is None:
            raise RuntimeError("Auxiliary window factory is not ready")

        focus: WindowSession | None = None
        session_id = uuid.uuid4().hex
        with self._lock:
            key = self._key(name)
            owner_id = self._note_owners.get(key) or self._reservations.get(key)
            if owner_id is not None:
                focus = self._sessions.get(owner_id)
            else:
                self._reservations[key] = session_id
                if restored_bounds is None:
                    width, height = self._saved_size_locked(name)
                    x, y = self._next_position_locked()
                    position_space = None
                else:
                    width, height, x, y, position_space = restored_bounds
        if owner_id is not None:
            if focus is not None:
                self._focus(focus)
            return {"status": "focused"}

        try:
            factory(session_id, name, width, height, x, y, position_space)
        except Exception:
            with self._lock:
                self._reservations.pop(self._key(name), None)
            raise
        return {"status": "opened"}

    def request_note_rename(self, name: str) -> dict[str, str]:
        with self._lock:
            owner_id = self._note_owners.get(self._key(name))
            owner = self._sessions.get(owner_id) if owner_id is not None else None
        if owner is None:
            return {"status": "available"}

        self._focus(owner)
        try:
            owner.window.run_js("window.desktopNotesBeginRename?.()")
        except Exception:
            pass
        return {"status": "focused"}

    def rename_note(
        self,
        session_id: str,
        old_name: str,
        requested_name: str,
        action: Callable[[], Any],
    ) -> Any:
        focus: WindowSession | None = None
        with self._lock:
            owner_id = self._note_owners.get(self._key(old_name))
            if owner_id is not None and owner_id != session_id:
                focus = self._sessions.get(owner_id)
            if focus is None:
                result = action()
                new_name = result.name
                if owner_id == session_id:
                    session = self._sessions[session_id]
                    self._note_owners.pop(self._key(old_name), None)
                    session.note_name = new_name
                    self._note_owners[self._key(new_name)] = session_id
                self._move_saved_size_locked(old_name, new_name)
        if focus is not None:
            self._focus(focus)
            raise UserVisibleError(text(
                "Rename it in its open window.",
                "请在已打开的窗口中重命名。",
            ))
        self.refresh_titles()
        self._refresh_main_home()
        return result

    def ensure_note_is_not_open_elsewhere(self, session_id: str, name: str) -> None:
        focus: WindowSession | None = None
        with self._lock:
            owner_id = self._note_owners.get(self._key(name))
            if owner_id is not None and owner_id != session_id:
                focus = self._sessions.get(owner_id)
        if focus is not None:
            self._focus(focus)
            raise UserVisibleError(text(
                "Close its other window first.",
                "请先关闭这条记录的其他窗口。",
            ))

    def ensure_storage_can_move(self) -> None:
        with self._lock:
            if not self._auxiliary_sessions_locked():
                return
        raise UserVisibleError(text(
            "Close the separate note windows before changing the storage folder.",
            "更改保存目录前，请先关闭独立记录窗口。",
        ))

    def close_session(self, session_id: str) -> None:
        destroy: WindowSession | None = None
        with self._lock:
            session = self._sessions[session_id]
            if session.role != "main":
                destroy = session
                auxiliaries: list[WindowSession] = []
                if not self._main_close_pending and session.note_name:
                    if session.state_saver is not None:
                        session.state_saver.flush()
                        session.state_saver.stop()
                    self._remove_open_window_locked(session.note_name)
            else:
                auxiliaries = self._auxiliary_sessions_locked()
                if not auxiliaries:
                    destroy = session
                else:
                    self._main_close_pending = True
        if destroy is not None:
            destroy.bridge.allow_close = True
            destroy.window.destroy()
            return
        for auxiliary in auxiliaries:
            auxiliary.window.run_js("window.desktopNotesRequestClose?.()")

    def cancel_app_close(self) -> None:
        with self._lock:
            self._main_close_pending = False
            self._discard_closed_window_states_locked()

    def refresh_titles(self) -> None:
        with self._lock:
            sessions = list(self._sessions.values())
            open_note_count = sum(session.note_name is not None for session in sessions)
            app_title = text("Bitty", "小记")
            titles = []
            for session in sessions:
                if session.role == "main":
                    title = (
                        self._display_name(session.note_name)
                        if session.note_name and open_note_count > 1
                        else app_title
                    )
                else:
                    title = self._display_name(session.note_name) if session.note_name else app_title
                titles.append((session.window, title))
        for window, title in titles:
            try:
                window.set_title(title)
            except Exception:
                pass

    def saved_size(self, name: str) -> tuple[int, int]:
        with self._lock:
            return self._saved_size_locked(name)

    def save_size(self, name: str, width: int, height: int) -> None:
        with self._lock:
            sizes = dict(self.config_store.config.note_window_sizes)
            existing_key = self._stored_key_locked(sizes, name)
            if existing_key is not None and existing_key != name:
                sizes.pop(existing_key, None)
            sizes[name] = {"width": width, "height": height}
            self.config_store.update(note_window_sizes=sizes)

    def save_window_state(
        self,
        name: str,
        x: int,
        y: int,
        width: int,
        height: int,
    ) -> None:
        with self._lock:
            sizes = dict(self.config_store.config.note_window_sizes)
            windows = dict(self.config_store.config.open_note_windows)
            existing_size_key = self._stored_key_locked(sizes, name)
            if existing_size_key is not None and existing_size_key != name:
                sizes.pop(existing_size_key, None)
            existing_window_key = self._stored_key_locked(windows, name)
            if existing_window_key is not None and existing_window_key != name:
                windows.pop(existing_window_key, None)
            sizes[name] = {"width": width, "height": height}
            windows[name] = {
                "x": x,
                "y": y,
                "width": width,
                "height": height,
            }
            self.config_store.update(
                note_window_sizes=sizes,
                open_note_windows=windows,
            )

    def reconcile_saved_sizes(self, existing_names: list[str]) -> None:
        existing = {self._key(name) for name in existing_names}
        with self._lock:
            open_names = set(self._note_owners) | set(self._reservations)
            sizes = self.config_store.config.note_window_sizes
            cleaned = {
                name: size
                for name, size in sizes.items()
                if self._key(name) in existing or self._key(name) in open_names
            }
            windows = self.config_store.config.open_note_windows
            cleaned_windows = {
                name: bounds
                for name, bounds in windows.items()
                if self._key(name) in existing or self._key(name) in open_names
            }
            changes: dict[str, Any] = {}
            if cleaned != sizes:
                changes["note_window_sizes"] = cleaned
            if cleaned_windows != windows:
                changes["open_note_windows"] = cleaned_windows
            if changes:
                self.config_store.update(**changes)

    def note_name(self, session_id: str) -> str | None:
        with self._lock:
            session = self._sessions.get(session_id)
            return session.note_name if session else None

    def _saved_size_locked(self, name: str) -> tuple[int, int]:
        sizes = self.config_store.config.note_window_sizes
        stored_key = self._stored_key_locked(sizes, name)
        if stored_key is None:
            return 350, 530
        size = sizes[stored_key]
        return size["width"], size["height"]

    def _move_saved_size_locked(self, old_name: str, new_name: str) -> None:
        sizes = dict(self.config_store.config.note_window_sizes)
        stored_key = self._stored_key_locked(sizes, old_name)
        windows = dict(self.config_store.config.open_note_windows)
        stored_window_key = self._stored_key_locked(windows, old_name)
        changes: dict[str, Any] = {}
        if stored_key is not None:
            size = sizes.pop(stored_key)
            sizes[new_name] = size
            changes["note_window_sizes"] = sizes
        if stored_window_key is not None:
            bounds = windows.pop(stored_window_key)
            windows[new_name] = bounds
            changes["open_note_windows"] = windows
        if changes:
            self.config_store.update(**changes)

    def _remove_open_window_locked(self, name: str) -> None:
        windows = dict(self.config_store.config.open_note_windows)
        stored_key = self._stored_key_locked(windows, name)
        if stored_key is None:
            return
        windows.pop(stored_key)
        self.config_store.update(open_note_windows=windows)

    def _discard_closed_window_states_locked(self) -> None:
        open_names = {
            self._key(session.note_name)
            for session in self._auxiliary_sessions_locked()
            if session.note_name
        }
        windows = self.config_store.config.open_note_windows
        cleaned = {
            name: bounds
            for name, bounds in windows.items()
            if self._key(name) in open_names
        }
        if cleaned != windows:
            self.config_store.update(open_note_windows=cleaned)

    def _next_position_locked(self) -> tuple[int, int]:
        main = self._main_session_locked()
        offset = 24 * ((self._cascade_index % 8) + 1)
        self._cascade_index += 1
        return int(getattr(main.window, "x", 40)) + offset, int(getattr(main.window, "y", 40)) + offset

    def _main_session_locked(self) -> WindowSession:
        return next(session for session in self._sessions.values() if session.role == "main")

    def _auxiliary_sessions_locked(self) -> list[WindowSession]:
        return [session for session in self._sessions.values() if session.role != "main"]

    def _refresh_main_home(self) -> None:
        with self._lock:
            main = self._main_session_locked()
        try:
            main.window.run_js("window.desktopNotesRefreshHome?.()")
        except Exception:
            pass

    @staticmethod
    def _focus(session: WindowSession) -> None:
        try:
            focus_window(session.window)
        except Exception:
            pass

    @staticmethod
    def _stored_key_locked(sizes: dict[str, Any], name: str) -> str | None:
        key = name.casefold()
        return next((stored for stored in sizes if stored.casefold() == key), None)

    @staticmethod
    def _key(name: str) -> str:
        return name.casefold()

    @staticmethod
    def _display_name(name: str | None) -> str:
        return re.sub(r"\.md$", "", name or "", flags=re.IGNORECASE)
