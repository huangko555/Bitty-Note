from __future__ import annotations

import json
from pathlib import Path

from desktop_notes.config import ConfigStore


def test_existing_config_gets_editor_defaults(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps({"save_dir": str(tmp_path / "notes")}),
        encoding="utf-8",
    )

    config = ConfigStore(config_path, tmp_path / "fallback").config

    assert config.autostart is True
    assert config.editor_font == "DengXian"
    assert config.editor_font_size == 14
    assert config.heading_divider is True
    assert config.heading_list_highlight is True
    assert config.language == "en"


def test_invalid_editor_preferences_do_not_discard_other_config(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    save_dir = tmp_path / "notes"
    config_path.write_text(
        json.dumps(
            {
                "save_dir": str(save_dir),
                "autostart": True,
                "editor_font": "invalid\nfont",
                "editor_font_size": 99,
            }
        ),
        encoding="utf-8",
    )

    config = ConfigStore(config_path, tmp_path / "fallback").config

    assert config.save_dir == str(save_dir)
    assert config.autostart is True
    assert config.editor_font == "DengXian"
    assert config.editor_font_size == 14


def test_editor_preferences_are_persisted_atomically(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "notes")

    store.update(editor_font="霞鹜文楷 GB", editor_font_size=18)
    reloaded = ConfigStore(config_path, tmp_path / "notes").config

    assert reloaded.editor_font == "霞鹜文楷 GB"
    assert reloaded.editor_font_size == 18


def test_heading_divider_preference_is_persisted(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "notes")

    store.update(heading_divider=False)
    reloaded = ConfigStore(config_path, tmp_path / "notes").config

    assert reloaded.heading_divider is False


def test_heading_list_highlight_preference_is_persisted(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "notes")

    store.update(heading_list_highlight=False)
    reloaded = ConfigStore(config_path, tmp_path / "notes").config

    assert reloaded.heading_list_highlight is False


def test_legacy_font_id_is_migrated(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps({"save_dir": str(tmp_path / "notes"), "editor_font": "kaiti"}),
        encoding="utf-8",
    )

    config = ConfigStore(config_path, tmp_path / "fallback").config

    assert config.editor_font == "KaiTi"


def test_language_is_persisted(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "notes")

    store.update(language="zh-CN")

    assert ConfigStore(config_path, tmp_path / "notes").config.language == "zh-CN"


def test_invalid_language_falls_back_to_english(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps({"save_dir": str(tmp_path / "notes"), "language": "invalid"}),
        encoding="utf-8",
    )

    assert ConfigStore(config_path, tmp_path / "fallback").config.language == "en"
