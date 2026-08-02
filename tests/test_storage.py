from pathlib import Path

from desktop_notes.config import ConfigStore
from desktop_notes.storage import StorageManager


def test_migrate_verifies_switches_and_recycles_only_managed_files(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    source.mkdir()
    (source / "记录.md").write_text("正文", encoding="utf-8")
    (source / "不要移动.txt").write_text("保留", encoding="utf-8")
    archive = source / "归档"
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
    assert (target / "归档" / "旧记录.md").read_text(encoding="utf-8") == "旧正文"
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
