from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

import webview

from . import __version__
from .config import (
    ConfigStore,
    validate_editor_highlight_color,
    validate_editor_preferences,
    validate_text_highlight_color,
)
from .errors import UserVisibleError
from .fonts import list_system_fonts
from .i18n import set_language as set_backend_language, text
from .models import NoteSummary
from .platform_windows import (
    is_window_topmost,
    open_directory,
    open_file,
    send_file_to_trash,
    set_autostart,
    set_window_topmost,
    start_window_interaction,
    update_window_interaction,
    window_logical_bounds,
)
from .repository import NotesRepository
from .storage import StorageManager
from .updates import PROJECT_URL, UpdateService
from .window_coordinator import WindowCoordinator


class DesktopBridge:
    """Small interface exposed to JavaScript; filesystem details stay behind it."""

    def __init__(
        self,
        config_store: ConfigStore,
        coordinator: WindowCoordinator | None = None,
        *,
        session_id: str = "main",
        window_role: str = "main",
        initial_note: str | None = None,
    ):
        self.config_store = config_store
        self.coordinator = coordinator
        self.session_id = session_id
        self.window_role = window_role
        self.initial_note = initial_note
        self._repository = NotesRepository(Path(config_store.config.save_dir))
        self._storage = StorageManager(config_store, send_file_to_trash)
        self._updates = UpdateService(config_store)
        self._window: webview.Window | None = None
        self._window_interaction = None
        self._lock = threading.RLock()
        self._window_ready = False
        self._window_ready_callback: Callable[[], None] | None = None
        self._always_on_top = (
            config_store.config.always_on_top if window_role == "main" else False
        )
        self.allow_close = False

    def attach_window(self, window: webview.Window) -> None:
        self._window = window

    def _set_window_ready_callback(self, callback: Callable[[], None]) -> None:
        with self._lock:
            if not self._window_ready:
                self._window_ready_callback = callback
                return
        callback()

    def window_ready(self) -> None:
        with self._lock:
            self._window_ready = True
            callback = self._window_ready_callback
            self._window_ready_callback = None
        if callback is not None:
            callback()

    def bootstrap(self) -> dict[str, Any]:
        with self._lock:
            update_result = (
                self._updates.consume_result() if self.window_role == "main" else None
            )
            notes = self._ordered_notes()
            if self.coordinator is not None:
                self.coordinator.reconcile_saved_sizes([note.name for note in notes])
            config = self.config_store.config.to_dict()
            config["always_on_top"] = self._always_on_top
            return {
                "config": config,
                "notes": [self._note_summary_dict(note) for note in notes],
                "system_fonts": list_system_fonts(),
                "app_version": __version__,
                "update_state": self._updates.state(),
                "update_result": update_result,
                "window_role": self.window_role,
                "initial_note": self.initial_note,
            }

    def set_language(self, language: str) -> dict[str, str]:
        normalized = set_backend_language(language)
        self.config_store.update(language=normalized)
        if self.coordinator is not None:
            self.coordinator.refresh_titles()
        else:
            self._require_window().set_title(text("Bitty", "小记"))
        return {"language": normalized}

    def check_update(self, force: bool = False) -> dict[str, str | None]:
        return self._updates.check(force)

    def install_update(self) -> dict[str, str | None]:
        return self._updates.install()

    def open_project_homepage(self) -> None:
        import webbrowser

        if not webbrowser.open(PROJECT_URL):
            raise UserVisibleError(
                text(
                    "Couldn't open the GitHub project page.",
                    "无法打开 GitHub 项目主页。",
                )
            )

    def list_notes(self) -> list[dict[str, Any]]:
        notes = self._ordered_notes()
        if self.coordinator is not None:
            self.coordinator.reconcile_saved_sizes([note.name for note in notes])
        return [self._note_summary_dict(note) for note in notes]

    def list_archived_notes(self) -> list[dict[str, Any]]:
        return [note.to_dict() for note in self._repository.list_archived_notes()]

    def create_note(self, name: str) -> dict[str, Any]:
        return self._repository.create_note(name).to_dict()

    def duplicate_note(self, name: str, requested_name: str) -> dict[str, Any]:
        return self._repository.duplicate_note(name, requested_name).to_dict()

    def rename_note(self, name: str, requested_name: str) -> dict[str, Any]:
        if self.coordinator is None:
            renamed = self._repository.rename_note(name, requested_name)
        else:
            renamed = self.coordinator.rename_note(
                self.session_id,
                name,
                requested_name,
                lambda: self._repository.rename_note(name, requested_name),
            )
        self._replace_pinned_note(name, renamed.name)
        return renamed.to_dict()

    def acquire_note(self, name: str) -> dict[str, bool]:
        self._repository.open_note(name)
        available = (
            True
            if self.coordinator is None
            else self.coordinator.acquire_note(self.session_id, name)
        )
        return {"available": available}

    def open_note_window(self, name: str) -> dict[str, str]:
        self._repository.open_note(name)
        if self.coordinator is None:
            raise RuntimeError("Multiple windows are not configured")
        return self.coordinator.open_auxiliary(name)

    def request_note_rename(self, name: str) -> dict[str, str]:
        self._repository.open_note(name)
        if self.coordinator is None:
            return {"status": "available"}
        return self.coordinator.request_note_rename(name)

    def open_note(self, name: str) -> dict[str, Any]:
        return self._repository.open_note(name).to_dict()

    def save_note(
        self,
        name: str,
        content: str,
        revision: str,
        has_bom: bool,
        newline: str,
        force: bool,
    ) -> dict[str, Any]:
        return self._repository.save_note(
            name,
            content,
            revision,
            has_bom=has_bom,
            newline=newline,
            force=force,
        ).to_dict()

    def recreate_note(
        self,
        name: str,
        content: str,
        has_bom: bool,
        newline: str,
    ) -> dict[str, Any]:
        return self._repository.recreate_note(
            name,
            content,
            has_bom=has_bom,
            newline=newline,
        ).to_dict()

    def archive_note(self, name: str) -> dict[str, str]:
        if self.coordinator is not None:
            self.coordinator.ensure_note_is_not_open_elsewhere(self.session_id, name)
        archived_name = self._repository.archive_note(name)
        self._remove_pinned_note(name)
        return {"archived_name": archived_name}

    def trash_note(self, name: str) -> None:
        if self.coordinator is not None:
            self.coordinator.ensure_note_is_not_open_elsewhere(self.session_id, name)
        self._repository.trash_note(name, send_file_to_trash)
        self._remove_pinned_note(name)

    def set_note_pinned(self, name: str, pinned: bool) -> dict[str, list[str]]:
        self._repository.open_note(name)
        pinned_notes = [
            item
            for item in self.config_store.config.pinned_notes
            if item.casefold() != name.casefold()
        ]
        if pinned:
            pinned_notes.insert(0, name)
        self.config_store.update(pinned_notes=pinned_notes)
        return {"pinned_notes": pinned_notes}

    def restore_archived_note(self, name: str) -> dict[str, str]:
        return {"restored_name": self._repository.restore_archived_note(name)}

    def delete_archived_note(self, name: str) -> None:
        self._repository.delete_archived_note(name, send_file_to_trash)

    def _ordered_notes(self) -> list[NoteSummary]:
        notes = self._repository.list_notes()
        pinned_names = {
            name.casefold() for name in self.config_store.config.pinned_notes
        }
        return [
            note for note in notes if note.name.casefold() in pinned_names
        ] + [
            note for note in notes if note.name.casefold() not in pinned_names
        ]

    def _note_summary_dict(self, note: NoteSummary) -> dict[str, Any]:
        result = note.to_dict()
        result["pinned"] = any(
            name.casefold() == note.name.casefold()
            for name in self.config_store.config.pinned_notes
        )
        return result

    def _remove_pinned_note(self, name: str) -> None:
        pinned_notes = [
            item
            for item in self.config_store.config.pinned_notes
            if item.casefold() != name.casefold()
        ]
        if pinned_notes != self.config_store.config.pinned_notes:
            self.config_store.update(pinned_notes=pinned_notes)

    def _replace_pinned_note(self, old_name: str, new_name: str) -> None:
        pinned_notes = [
            new_name if item.casefold() == old_name.casefold() else item
            for item in self.config_store.config.pinned_notes
        ]
        if pinned_notes != self.config_store.config.pinned_notes:
            self.config_store.update(pinned_notes=pinned_notes)

    def choose_directory(self) -> str | None:
        window = self._require_window()
        selected = window.create_file_dialog(
            webview.FileDialog.FOLDER,
            directory=self.config_store.config.save_dir,
            allow_multiple=False,
        )
        return str(selected[0]) if selected else None

    def open_directory(self, path: str) -> None:
        open_directory(Path(path))

    def open_note_in_editor(self, name: str) -> None:
        note = self._repository.open_note(name)
        open_file(self._repository.root / note.name)

    def migrate_directory(self, path: str) -> dict[str, Any]:
        if not path.strip():
            raise UserVisibleError(
                text("Choose a different storage folder.", "请选择新的保存目录")
            )
        with self._lock:
            if self.coordinator is not None:
                self.coordinator.ensure_storage_can_move()
            result = self._storage.migrate(Path(path))
            self._repository = NotesRepository(Path(self.config_store.config.save_dir))
            return result.to_dict()

    def set_autostart(self, enabled: bool) -> dict[str, bool]:
        set_autostart(enabled)
        self.config_store.update(autostart=enabled)
        return {"enabled": enabled}

    def remember_last_note(self, name: str | None) -> None:
        if self.window_role != "main":
            return
        self.config_store.update(last_note=name)
        if name is None and self.coordinator is not None:
            self.coordinator.release_note(self.session_id)

    def set_always_on_top(self, enabled: bool) -> dict[str, bool]:
        window = self._require_window()
        previous = self._always_on_top
        set_window_topmost(window, enabled)
        try:
            if self.window_role == "main":
                self.config_store.update(always_on_top=enabled)
            self._always_on_top = enabled
        except Exception:
            try:
                set_window_topmost(window, previous)
            except Exception:
                pass
            raise
        return {"enabled": enabled}

    def get_always_on_top(self) -> dict[str, bool]:
        enabled = is_window_topmost(self._require_window())
        if self.window_role == "main" and self.config_store.config.always_on_top != enabled:
            self.config_store.update(always_on_top=enabled)
        self._always_on_top = enabled
        return {"enabled": enabled}

    def set_editor_preferences(
        self, editor_font: str, editor_font_size: int
    ) -> dict[str, Any]:
        validate_editor_preferences(editor_font, editor_font_size)
        updated = self.config_store.update(
            editor_font=editor_font,
            editor_font_size=editor_font_size,
        )
        return {
            "editor_font": updated.editor_font,
            "editor_font_size": updated.editor_font_size,
        }

    def set_heading_divider(self, enabled: bool) -> dict[str, bool]:
        self.config_store.update(heading_divider=enabled)
        return {"enabled": enabled}

    def set_heading_list_highlight(self, enabled: bool) -> dict[str, bool]:
        self.config_store.update(heading_list_highlight=enabled)
        return {"enabled": enabled}

    def set_editor_highlight_color(self, color: str) -> dict[str, str]:
        validate_editor_highlight_color(color)
        normalized = color.upper()
        self.config_store.update(
            editor_highlight_color=normalized,
            heading_list_highlight=True,
        )
        return {"color": normalized}

    def set_text_highlight_color(self, color: str) -> dict[str, str]:
        validate_text_highlight_color(color)
        self.config_store.update(text_highlight_color=color)
        return {"color": color}

    def start_window_interaction(self, region: str) -> None:
        with self._lock:
            self._window_interaction = start_window_interaction(
                self._require_window(), region
            )

    def update_window_interaction(self) -> None:
        with self._lock:
            interaction = self._window_interaction
        if interaction is not None:
            update_window_interaction(interaction)

    def end_window_interaction(self) -> None:
        with self._lock:
            self._window_interaction = None

    def minimize_window(self) -> None:
        self._require_window().minimize()

    def close_window(self) -> None:
        if self.coordinator is not None:
            self.coordinator.close_session(self.session_id)
            return
        self.allow_close = True
        self._require_window().destroy()

    def cancel_close(self) -> None:
        if self.coordinator is not None:
            self.coordinator.cancel_app_close()

    def _require_window(self) -> webview.Window:
        if self._window is None:
            raise UserVisibleError(text("The window isn't ready yet.", "窗口尚未准备完成。"))
        return self._window


class WindowStateSaver:
    """Debounces noisy window events into occasional atomic config writes."""

    def __init__(self, window: webview.Window, config_store: ConfigStore):
        self.window = window
        self.config_store = config_store
        self._timer: threading.Timer | None = None
        self._lock = threading.Lock()

    def schedule(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(0.4, self._save)
            self._timer.daemon = True
            self._timer.start()

    def flush(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
        self._save()

    def _save(self) -> None:
        try:
            x, y, width, height = window_logical_bounds(self.window)
            self.config_store.update(
                window_x=x,
                window_y=y,
                window_width=width,
                window_height=height,
                window_position_space="logical",
            )
        except Exception:
            # Window state is optional and must never take down the note editor.
            pass


class NoteWindowStateSaver:
    """Persists an open note window's logical position and dimensions."""

    def __init__(
        self,
        window: webview.Window,
        coordinator: WindowCoordinator,
        session_id: str,
    ):
        self.window = window
        self.coordinator = coordinator
        self.session_id = session_id
        self._timer: threading.Timer | None = None
        self._lock = threading.RLock()
        self._stopped = False

    def schedule(self) -> None:
        with self._lock:
            if self._stopped:
                return
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(0.4, self._save)
            self._timer.daemon = True
            self._timer.start()

    def flush(self) -> None:
        with self._lock:
            if self._stopped:
                return
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._save_locked()

    def stop(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
            self._stopped = True

    def _save(self) -> None:
        with self._lock:
            if self._stopped:
                return
            self._timer = None
            self._save_locked()

    def _save_locked(self) -> None:
        name = self.coordinator.note_name(self.session_id)
        if name is None:
            return
        try:
            x, y, width, height = window_logical_bounds(self.window)
            self.coordinator.save_window_state(name, x, y, width, height)
        except Exception:
            pass
