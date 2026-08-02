from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

from .config import ConfigStore
from .errors import UserVisibleError
from .models import MigrationResult


def _digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


class StorageManager:
    """Performs a verified storage switch and only then recycles old files."""

    def __init__(
        self,
        config_store: ConfigStore,
        trash_file: Callable[[Path], None],
    ):
        self.config_store = config_store
        self.trash_file = trash_file

    def migrate(self, target_directory: Path) -> MigrationResult:
        source = Path(self.config_store.config.save_dir).resolve()
        target = target_directory.resolve()
        if source == target:
            raise UserVisibleError("新保存目录与当前目录相同")
        if _is_relative_to(target, source) or _is_relative_to(source, target):
            raise UserVisibleError("新旧保存目录不能互相包含")

        sources = self._managed_files(source)
        target.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".desktop-notes-migration-", dir=target))
        plans: list[tuple[Path, Path, Path]] = []
        committed: list[Path] = []
        try:
            reserved: set[str] = set()
            for source_file, relative in sources:
                final_relative = self._unique_relative(target, relative, reserved)
                staged_file = stage / final_relative
                staged_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_file, staged_file)
                if _digest(source_file) != _digest(staged_file):
                    raise UserVisibleError(f"迁移校验失败：{source_file.name}")
                plans.append((source_file, staged_file, target / final_relative))

            for _, staged_file, final_file in plans:
                final_file.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staged_file, final_file)
                committed.append(final_file)

            try:
                self.config_store.update(save_dir=str(target))
            except OSError as error:
                self._rollback(committed)
                raise UserVisibleError(f"无法切换保存路径：{error}") from error

            retained: list[str] = []
            recycled_count = 0
            for source_file, _, _ in plans:
                try:
                    self.trash_file(source_file)
                    recycled_count += 1
                except Exception:
                    # Recycling is best-effort after the verified switch. Never
                    # degrade to permanent deletion or roll back the new copy.
                    retained.append(str(source_file))

            return MigrationResult(len(plans), recycled_count, tuple(retained))
        except UserVisibleError:
            self._rollback(committed)
            raise
        except OSError as error:
            self._rollback(committed)
            raise UserVisibleError(f"迁移保存目录失败：{error}") from error
        finally:
            shutil.rmtree(stage, ignore_errors=True)

    @staticmethod
    def _managed_files(root: Path) -> list[tuple[Path, Path]]:
        managed: list[tuple[Path, Path]] = []
        if root.exists():
            for item in root.iterdir():
                if item.is_file() and not item.is_symlink() and item.suffix.lower() == ".md":
                    managed.append((item, Path(item.name)))
            archive = root / "归档"
            if archive.is_dir() and not archive.is_symlink():
                for item in archive.rglob("*"):
                    if item.is_file() and not item.is_symlink():
                        managed.append((item, Path("归档") / item.relative_to(archive)))
        return sorted(managed, key=lambda pair: str(pair[1]).casefold())

    @staticmethod
    def _unique_relative(target: Path, relative: Path, reserved: set[str]) -> Path:
        parent = relative.parent
        stem = relative.stem
        suffix = relative.suffix
        candidate = relative
        index = 2
        while (target / candidate).exists() or str(candidate).casefold() in reserved:
            candidate = parent / f"{stem} ({index}){suffix}"
            index += 1
        reserved.add(str(candidate).casefold())
        return candidate

    @staticmethod
    def _rollback(committed: list[Path]) -> None:
        for path in reversed(committed):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
