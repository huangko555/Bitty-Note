from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import asdict, dataclass, fields, replace
from pathlib import Path
from typing import Any

from .i18n import SUPPORTED_LANGUAGES


DEFAULT_EDITOR_FONT = "DengXian"
DEFAULT_EDITOR_FONT_SIZE = 14
MIN_EDITOR_FONT_SIZE = 12
MAX_EDITOR_FONT_SIZE = 22
LEGACY_EDITOR_FONTS = {
    "microsoft_yahei": "Microsoft YaHei",
    "dengxian": "DengXian",
    "simsun": "SimSun",
    "kaiti": "KaiTi",
    "system": "Microsoft YaHei",
}


def validate_editor_preferences(editor_font: str, editor_font_size: int) -> None:
    if (
        not isinstance(editor_font, str)
        or not editor_font.strip()
        or len(editor_font) > 100
        or any(ord(character) < 32 for character in editor_font)
    ):
        raise ValueError("Unsupported editor font")
    if (
        isinstance(editor_font_size, bool)
        or not isinstance(editor_font_size, int)
        or not MIN_EDITOR_FONT_SIZE <= editor_font_size <= MAX_EDITOR_FONT_SIZE
    ):
        raise ValueError("Editor font size is out of range")


@dataclass(frozen=True)
class AppConfig:
    save_dir: str
    language: str = "en"
    autostart: bool = True
    always_on_top: bool = False
    window_x: int | None = None
    window_y: int | None = None
    window_width: int = 350
    window_height: int = 530
    last_note: str | None = None
    editor_font: str = DEFAULT_EDITOR_FONT
    editor_font_size: int = DEFAULT_EDITOR_FONT_SIZE
    spellcheck: bool = False
    heading_divider: bool = True
    heading_list_highlight: bool = True
    last_update_check_ms: int | None = None
    available_version: str | None = None
    pending_update_version: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ConfigStore:
    """Persists the complete application configuration as one atomic JSON file."""

    def __init__(self, path: Path, default_save_dir: Path):
        self.path = path
        self.default_save_dir = default_save_dir
        self._lock = threading.RLock()
        self._config = self._load()

    @property
    def config(self) -> AppConfig:
        with self._lock:
            return self._config

    def update(self, **changes: Any) -> AppConfig:
        allowed = {item.name for item in fields(AppConfig)}
        unknown = changes.keys() - allowed
        if unknown:
            raise ValueError(f"Unknown configuration fields: {sorted(unknown)}")
        with self._lock:
            updated = replace(self._config, **changes)
            self._write(updated)
            self._config = updated
            return updated

    def _load(self) -> AppConfig:
        if not self.path.exists():
            return AppConfig(save_dir=str(self.default_save_dir))
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            allowed = {item.name for item in fields(AppConfig)}
            values = {key: value for key, value in raw.items() if key in allowed}
            values.setdefault("save_dir", str(self.default_save_dir))
            if values.get("language", "en") not in SUPPORTED_LANGUAGES:
                values["language"] = "en"
            editor_font = values.get("editor_font", DEFAULT_EDITOR_FONT)
            if isinstance(editor_font, str):
                values["editor_font"] = LEGACY_EDITOR_FONTS.get(
                    editor_font, editor_font
                )
            try:
                validate_editor_preferences(
                    values.get("editor_font", DEFAULT_EDITOR_FONT),
                    values.get("editor_font_size", DEFAULT_EDITOR_FONT_SIZE),
                )
            except ValueError:
                values["editor_font"] = DEFAULT_EDITOR_FONT
                values["editor_font_size"] = DEFAULT_EDITOR_FONT_SIZE
            return AppConfig(**values)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return AppConfig(save_dir=str(self.default_save_dir))

    def _write(self, config: AppConfig) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, raw_temp_path = tempfile.mkstemp(
            prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent
        )
        temp_path = Path(raw_temp_path)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
                json.dump(config.to_dict(), stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_path, self.path)
        finally:
            temp_path.unlink(missing_ok=True)
