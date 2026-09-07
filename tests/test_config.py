from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from desktop_notes.bridge import DesktopBridge
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
    assert config.editor_highlight_color == "#456FC4"
    assert config.text_highlight_color == "red"
    assert config.language == "en"
    assert config.window_width == 350
    assert config.window_height == 530
    assert config.open_note_windows == {}
    assert config.pinned_notes == []


def test_open_note_window_bounds_are_validated_when_loading_config(
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps({
            "save_dir": str(tmp_path / "notes"),
            "open_note_windows": {
                "Kept.md": {"x": -320, "y": 90, "width": 420, "height": 640},
                "Missing height.md": {"x": 1, "y": 2, "width": 300},
                "Boolean.md": {"x": True, "y": 2, "width": 300, "height": 500},
            },
        }),
        encoding="utf-8",
    )

    config = ConfigStore(config_path, tmp_path / "fallback").config

    assert config.open_note_windows == {
        "Kept.md": {"x": -320, "y": 90, "width": 420, "height": 640}
    }


def test_pinned_notes_are_persisted_ordered_and_cleaned_up(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store)
    bridge.create_note("第一条")
    bridge.create_note("第二条")

    assert bridge.set_note_pinned("第一条.md", True) == {
        "pinned_notes": ["第一条.md"]
    }
    listed_notes = bridge.list_notes()
    assert [note["name"] for note in listed_notes][0] == "第一条.md"
    assert listed_notes[0]["pinned"] is True
    assert ConfigStore(store.path, tmp_path / "notes").config.pinned_notes == [
        "第一条.md"
    ]

    bridge.set_note_pinned("第二条.md", True)
    os.utime(tmp_path / "notes" / "第一条.md", ns=(2_000_000_000, 2_000_000_000))
    os.utime(tmp_path / "notes" / "第二条.md", ns=(1_000_000_000, 1_000_000_000))
    assert [note["name"] for note in bridge.list_notes()][:2] == [
        "第一条.md",
        "第二条.md",
    ]

    renamed = bridge.rename_note("第一条.md", "置顶记录")
    assert renamed["name"] == "置顶记录.md"
    assert store.config.pinned_notes == ["第二条.md", "置顶记录.md"]

    bridge.archive_note("置顶记录.md")
    assert store.config.pinned_notes == ["第二条.md"]
    restored = bridge.restore_archived_note("置顶记录.md")
    restored_note = next(
        note for note in bridge.list_notes() if note["name"] == restored["restored_name"]
    )
    assert restored_note["pinned"] is False


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


def test_legacy_spellcheck_preference_is_ignored(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps({"save_dir": str(tmp_path / "notes"), "spellcheck": True}),
        encoding="utf-8",
    )

    config = ConfigStore(config_path, tmp_path / "fallback").config

    assert "spellcheck" not in config.to_dict()


def test_heading_list_highlight_preference_is_persisted(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "notes")

    store.update(heading_list_highlight=False)
    reloaded = ConfigStore(config_path, tmp_path / "notes").config

    assert reloaded.heading_list_highlight is False


def test_editor_highlight_color_is_persisted(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "notes")

    store.update(editor_highlight_color="#C36B32")

    assert ConfigStore(config_path, tmp_path / "notes").config.editor_highlight_color == "#C36B32"


def test_invalid_editor_highlight_color_falls_back_without_discarding_config(
    tmp_path: Path,
) -> None:
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps(
            {
                "save_dir": str(tmp_path / "notes"),
                "autostart": False,
                "editor_highlight_color": "blue",
            }
        ),
        encoding="utf-8",
    )

    config = ConfigStore(config_path, tmp_path / "fallback").config

    assert config.autostart is False
    assert config.editor_highlight_color == "#456FC4"


def test_text_highlight_color_is_validated_and_persisted(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path, tmp_path / "notes")

    store.update(text_highlight_color="blue")
    assert ConfigStore(config_path, tmp_path / "notes").config.text_highlight_color == "blue"

    config_path.write_text(
        json.dumps({"save_dir": str(tmp_path / "notes"), "text_highlight_color": "orange"}),
        encoding="utf-8",
    )
    assert ConfigStore(config_path, tmp_path / "notes").config.text_highlight_color == "red"


def test_text_highlight_color_bridge_rejects_unsupported_colors(tmp_path: Path) -> None:
    store = ConfigStore(tmp_path / "config.json", tmp_path / "notes")
    bridge = DesktopBridge(store)

    assert bridge.set_text_highlight_color("blue") == {"color": "blue"}
    assert store.config.text_highlight_color == "blue"
    with pytest.raises(ValueError, match="Unsupported text highlight color"):
        bridge.set_text_highlight_color("orange")


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
