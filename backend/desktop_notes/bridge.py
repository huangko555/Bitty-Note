from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import webview

from . import __version__
from .config import ConfigStore, validate_editor_preferences
from .errors import UserVisibleError
from .fonts import list_system_fonts
from .i18n import set_language as set_backend_language, text
from .platform_windows import (
    is_window_topmost,
    open_directory,
    send_file_to_trash,
    set_autostart,
    set_window_topmost,
    start_window_interaction,
    update_window_interaction,
)
from .repository import NotesRepository
from .storage import StorageManager
from .updates import PROJECT_URL, UpdateService


class DesktopBridge:
    """Small interface exposed to JavaScript; filesystem details stay behind it."""

    def __init__(self, config_store: ConfigStore):
        self.config_store = config_store
        self._repository = NotesRepository(Path(config_store.config.save_dir))
        self._storage = StorageManager(config_store, send_file_to_trash)
        self._updates = UpdateService(config_store)
        self._window: webview.Window | None = None
        self._window_interaction = None
        self._lock = threading.RLock()
        self.allow_close = False

    def attach_window(self, window: webview.Window) -> None:
        self._window = window

    def bootstrap(self) -> dict[str, Any]:
        with self._lock:
            update_result = self._updates.consume_result()
            return {
                "config": self.config_store.config.to_dict(),
                "notes": [note.to_dict() for note in self._repository.list_notes()],
                "system_fonts": list_system_fonts(),
                "app_version": __version__,
                "update_state": self._updates.state(),
                "update_result": update_result,
            }

    def set_language(self, language: str) -> dict[str, str]:
        normalized = set_backend_language(language)
        self.config_store.update(language=normalized)
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
        return [note.to_dict() for note in self._repository.list_notes()]

    def list_archived_notes(self) -> list[dict[str, Any]]:
        return [note.to_dict() for note in self._repository.list_archived_notes()]

    def create_note(self, name: str) -> dict[str, Any]:
        return self._repository.create_note(name).to_dict()

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
        return {"archived_name": self._repository.archive_note(name)}

    def restore_archived_note(self, name: str) -> dict[str, str]:
        return {"restored_name": self._repository.restore_archived_note(name)}

    def delete_archived_note(self, name: str) -> None:
        self._repository.delete_archived_note(name, send_file_to_trash)

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

    def migrate_directory(self, path: str) -> dict[str, Any]:
        if not path.strip():
            raise UserVisibleError(
                text("Choose a different storage folder.", "请选择新的保存目录")
            )
        with self._lock:
            result = self._storage.migrate(Path(path))
            self._repository = NotesRepository(Path(self.config_store.config.save_dir))
            return result.to_dict()

    def set_autostart(self, enabled: bool) -> dict[str, bool]:
        set_autostart(enabled)
        self.config_store.update(autostart=enabled)
        return {"enabled": enabled}

    def remember_last_note(self, name: str | None) -> None:
        self.config_store.update(last_note=name)

    def set_always_on_top(self, enabled: bool) -> dict[str, bool]:
        window = self._require_window()
        previous = self.config_store.config.always_on_top
        set_window_topmost(window, enabled)
        try:
            self.config_store.update(always_on_top=enabled)
        except Exception:
            try:
                set_window_topmost(window, previous)
            except Exception:
                pass
            raise
        return {"enabled": enabled}

    def get_always_on_top(self) -> dict[str, bool]:
        enabled = is_window_topmost(self._require_window())
        if self.config_store.config.always_on_top != enabled:
            self.config_store.update(always_on_top=enabled)
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
        self.allow_close = True
        self._require_window().destroy()

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
            self.config_store.update(
                window_x=self.window.x,
                window_y=self.window.y,
                window_width=self.window.width,
                window_height=self.window.height,
            )
        except Exception:
            # Window state is optional and must never take down the note editor.
            pass
