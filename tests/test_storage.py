from pathlib import Path

from desktop_notes.config import ConfigStore
from desktop_notes.storage import StorageManager


def test_migrate_verifies_switches_and_recycles_only_managed_files(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.mkdir()
    (source / "记录.md").write_text("正文", encoding="utf-8")
    (source / "不要移动.txt").write_text("保留", encoding="utf-8")
    archive = source / "Archive"
    archive.mkdir()
    (archive / "旧记录.md").write_text("旧正文", encoding="utf-8")

    config = ConfigStore(tmp_path / "config.json", source)
    recycled: list[Path] = []

    def fake_trash(path: Path) -> None:
        recycled.append(path)
        path.unlink()

    result = StorageManager(config, fake_trash).migrate(target)

    assert result.copied_count == 2
    assert result.recycled_count == 2
    assert config.config.save_dir == str(target.resolve())
    assert (target / "记录.md").read_text(encoding="utf-8") == "正文"
    assert (target / "Archive" / "旧记录.md").read_text(encoding="utf-8") == "旧正文"
    assert (source / "不要移动.txt").exists()
    assert set(recycled) == {source / "记录.md", archive / "旧记录.md"}


def test_migrate_keeps_source_when_recycle_bin_fails(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.mkdir()
    note = source / "记录.md"
    note.write_text("正文", encoding="utf-8")
    config = ConfigStore(tmp_path / "config.json", source)

    def failed_trash(_path: Path) -> None:
        raise OSError("recycle bin unavailable")

    result = StorageManager(config, failed_trash).migrate(target)

    assert config.config.save_dir == str(target.resolve())
    assert note.exists()
    assert result.retained_files == (str(note),)


def test_migrate_renames_target_collision_without_overwrite(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.mkdir()
    target.mkdir()
    (source / "记录.md").write_text("来源", encoding="utf-8")
    (target / "记录.md").write_text("目标", encoding="utf-8")
    config = ConfigStore(tmp_path / "config.json", source)

    manager = StorageManager(config, lambda path: path.unlink())
    manager.migrate(target)

    assert (target / "记录.md").read_text(encoding="utf-8") == "目标"
    assert (target / "记录 (2).md").read_text(encoding="utf-8") == "来源"


def test_migration_keeps_source_edited_after_copy(tmp_path, monkeypatch):
    source, target = tmp_path / "source", tmp_path / "target"
    source.mkdir()
    note = source / "Note.md"
    note.write_text("copied content", encoding="utf-8")
    config = ConfigStore(tmp_path / "config.json", source)
    update = config.update

    def update_and_edit(**changes):
        result = update(**changes)
        note.write_text("new content written during migration", encoding="utf-8")
        return result

    monkeypatch.setattr(config, "update", update_and_edit)
    result = StorageManager(config, lambda path: path.unlink()).migrate(target)
    assert note.read_text(encoding="utf-8") == "new content written during migration"
    assert result.retained_files == (str(note),)
    assert (target / note.name).read_text(encoding="utf-8") == "copied content"


def test_migration_does_not_overwrite_a_target_created_during_copy(tmp_path, monkeypatch):
    import pytest
    from desktop_notes import storage
    from desktop_notes.errors import UserVisibleError

    source, target = tmp_path / "source", tmp_path / "target"
    source.mkdir()
    target.mkdir()
    note = source / "Note.md"
    note.write_text("source", encoding="utf-8")
    config = ConfigStore(tmp_path / "config.json", source)
    copy = storage.shutil.copy2

    def copy_and_create_target(src, destination):
        result = copy(src, destination)
        (target / note.name).write_text("concurrent target", encoding="utf-8")
        return result

    monkeypatch.setattr(storage.shutil, "copy2", copy_and_create_target)
    with pytest.raises(UserVisibleError):
        StorageManager(config, lambda path: path.unlink()).migrate(target)
    assert (target / note.name).read_text(encoding="utf-8") == "concurrent target"
    assert note.read_text(encoding="utf-8") == "source"
    assert config.config.save_dir == str(source)
