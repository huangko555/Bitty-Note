from pathlib import Path

from desktop_notes.repository import NotesRepository


def test_create_sanitizes_and_deduplicates_names(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)

    first = repository.create_note('  CON<>:"/\\|?*  ')
    second = repository.create_note(first.name.upper())

    assert first.name == "CON---------.md"
    assert second.name == "CON--------- (2).md"
    assert {note.name for note in repository.list_notes()} == {first.name, second.name}


def test_duplicate_preserves_bytes_and_deduplicates_name(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)
    source = repository.create_note("记录")
    source_path = tmp_path / source.name
    source_bytes = b"\xef\xbb\xbffirst\r\nsecond\r\n"
    source_path.write_bytes(source_bytes)

    first = repository.duplicate_note(source.name, "记录 副本")
    second = repository.duplicate_note(source.name, "记录 副本")

    assert first.name == "记录 副本.md"
    assert second.name == "记录 副本 (2).md"
    assert (tmp_path / first.name).read_bytes() == source_bytes
    assert first.content == "first\nsecond\n"
    assert first.has_bom is True
    assert first.newline == "\r\n"


def test_note_previews_hide_empty_line_markers(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)
    note = repository.create_note("记录")
    (tmp_path / note.name).write_text(
        "<!-- bitty-empty-line -->\n# 标题\n- <!-- bitty-empty-line -->\n正文",
        encoding="utf-8",
    )

    assert repository.list_notes()[0].preview == "标题 正文"

    repository.archive_note(note.name)

    assert repository.list_archived_notes()[0].preview == "标题 正文"


def test_save_detects_external_change_before_overwrite(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)
    opened = repository.create_note("记录")
    path = tmp_path / opened.name
    path.write_text("外部内容", encoding="utf-8")

    conflict = repository.save_note(
        opened.name,
        "本地内容",
        opened.revision,
        has_bom=False,
        newline="\n",
    )

    assert conflict.status == "conflict"
    assert conflict.external_content == "外部内容"
    assert path.read_text(encoding="utf-8") == "外部内容"


def test_save_preserves_bom_and_crlf(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)
    path = tmp_path / "格式.md"
    path.write_bytes(b"\xef\xbb\xbfline 1\r\nline 2\r\n")
    opened = repository.open_note(path.name)

    result = repository.save_note(
        path.name,
        "更新 1\n更新 2\n",
        opened.revision,
        has_bom=opened.has_bom,
        newline=opened.newline,
    )

    assert result.status == "saved"
    assert path.read_bytes() == b"\xef\xbb\xbf\xe6\x9b\xb4\xe6\x96\xb0 1\r\n\xe6\x9b\xb4\xe6\x96\xb0 2\r\n"


def test_archive_never_overwrites_existing_file(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)
    note = repository.create_note("记录")
    archive = tmp_path / "Archive"
    archive.mkdir()
    (archive / note.name).write_text("旧内容", encoding="utf-8")

    archived_name = repository.archive_note(note.name)

    assert archived_name == "记录 (2).md"
    assert (archive / note.name).read_text(encoding="utf-8") == "旧内容"
    assert (archive / archived_name).exists()


def test_list_restore_and_delete_archived_notes(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)
    note = repository.create_note("记录")
    (tmp_path / note.name).write_text("归档正文", encoding="utf-8")
    archived_name = repository.archive_note(note.name)

    archived = repository.list_archived_notes()

    assert [(item.name, item.preview) for item in archived] == [(archived_name, "归档正文")]

    repository.create_note("记录")
    restored_name = repository.restore_archived_note(archived_name)

    assert restored_name == "记录 (2).md"
    assert (tmp_path / restored_name).read_text(encoding="utf-8") == "归档正文"

    repository.archive_note(restored_name)
    recycled: list[Path] = []

    def fake_trash(path: Path) -> None:
        recycled.append(path)
        path.unlink()

    repository.delete_archived_note(restored_name, fake_trash)

    assert recycled == [tmp_path / "Archive" / restored_name]
    assert repository.list_archived_notes() == []


def test_legacy_archive_directory_is_renamed(tmp_path: Path) -> None:
    legacy_archive = tmp_path / "归档"
    legacy_archive.mkdir()
    (legacy_archive / "旧记录.md").write_text("旧正文", encoding="utf-8")

    repository = NotesRepository(tmp_path)

    assert not legacy_archive.exists()
    assert (tmp_path / "Archive" / "旧记录.md").read_text(encoding="utf-8") == "旧正文"
    assert [note.name for note in repository.list_archived_notes()] == ["旧记录.md"]


def test_legacy_archive_is_merged_without_overwriting(tmp_path: Path) -> None:
    archive = tmp_path / "Archive"
    legacy_archive = tmp_path / "归档"
    archive.mkdir()
    legacy_archive.mkdir()
    (archive / "记录.md").write_text("新目录", encoding="utf-8")
    (legacy_archive / "记录.md").write_text("旧目录", encoding="utf-8")

    NotesRepository(tmp_path)

    assert not legacy_archive.exists()
    assert (archive / "记录.md").read_text(encoding="utf-8") == "新目录"
    assert (archive / "记录 (2).md").read_text(encoding="utf-8") == "旧目录"
