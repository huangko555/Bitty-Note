from __future__ import annotations

import hashlib
import os
import re
import tempfile
import threading
from collections.abc import Callable
from datetime import date
from pathlib import Path

from .errors import UserVisibleError
from .i18n import text as message
from .models import NoteSummary, OpenedNote, SaveResult

_INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_MARKDOWN_MARKERS = re.compile(
    r"^(?:#{1,6}\s+|[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)|"
    r"(\*\*|__|~~|(?<!\*)\*(?!\*)|(?<!_)_(?!_))"
)
_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}
ARCHIVE_DIRECTORY = "Archive"
_LEGACY_ARCHIVE_DIRECTORY = "归档"


def content_revision(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _decode_utf8(data: bytes, name: str) -> tuple[str, bool, str]:
    has_bom = data.startswith(b"\xef\xbb\xbf")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise UserVisibleError(message(
            f'“{name}” is not a supported UTF-8 file. Overwriting was prevented.',
            f"“{name}”不是受支持的 UTF-8 文件，已阻止覆盖。",
        )) from error
    newline = "\r\n" if "\r\n" in text else "\n"
    return text.replace("\r\n", "\n").replace("\r", "\n"), has_bom, newline


def _encode_utf8(content: str, has_bom: bool, newline: str) -> bytes:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    if newline == "\r\n":
        normalized = normalized.replace("\n", "\r\n")
    prefix = b"\xef\xbb\xbf" if has_bom else b""
    return prefix + normalized.encode("utf-8")


def _plain_preview(text: str) -> str:
    preview_lines: list[str] = []
    for raw_line in text.splitlines():
        line = _MARKDOWN_MARKERS.sub("", raw_line.strip()).strip()
        if line:
            preview_lines.append(line)
        if len(preview_lines) == 3:
            break
    preview = " ".join(preview_lines)
    return preview if len(preview) <= 120 else f"{preview[:119]}…"


class NotesRepository:
    """Owns all filesystem rules for notes below one root directory."""

    def __init__(self, root: Path):
        self.root = root.resolve()
        self._lock = threading.RLock()
        self.root.mkdir(parents=True, exist_ok=True)
        self._migrate_legacy_archive_directory()

    def list_notes(self) -> list[NoteSummary]:
        notes: list[NoteSummary] = []
        with self._lock:
            for entry in os.scandir(self.root):
                if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                    continue
                if Path(entry.name).suffix.lower() != ".md":
                    continue
                try:
                    data = Path(entry.path).read_bytes()
                    text, _, _ = _decode_utf8(data, entry.name)
                    preview = _plain_preview(text)
                except (OSError, UserVisibleError):
                    preview = message("Couldn't read this file", "无法读取此文件")
                notes.append(
                    NoteSummary(
                        name=entry.name,
                        preview=preview,
                        modified_ms=entry.stat(follow_symlinks=False).st_mtime_ns // 1_000_000,
                    )
                )
        return sorted(notes, key=lambda note: (-note.modified_ms, note.name.casefold()))

    def list_archived_notes(self) -> list[NoteSummary]:
        archive_dir = self.root / ARCHIVE_DIRECTORY
        if not archive_dir.is_dir() or archive_dir.is_symlink():
            return []
        notes: list[NoteSummary] = []
        with self._lock:
            for entry in os.scandir(archive_dir):
                if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                    continue
                if Path(entry.name).suffix.lower() != ".md":
                    continue
                try:
                    data = Path(entry.path).read_bytes()
                    text, _, _ = _decode_utf8(data, entry.name)
                    preview = _plain_preview(text)
                except (OSError, UserVisibleError):
                    preview = message("Couldn't read this file", "无法读取此文件")
                notes.append(
                    NoteSummary(
                        name=entry.name,
                        preview=preview,
                        modified_ms=entry.stat(follow_symlinks=False).st_mtime_ns // 1_000_000,
                    )
                )
        return sorted(notes, key=lambda note: (-note.modified_ms, note.name.casefold()))

    def create_note(self, requested_name: str) -> OpenedNote:
        with self._lock:
            safe_name = self._safe_filename(requested_name)
            path = self._unique_path(self.root, safe_name)
            try:
                with path.open("xb"):
                    pass
            except OSError as error:
                raise UserVisibleError(message(
                    f"Couldn't create the note: {error}", f"无法创建记录：{error}"
                )) from error
            return self._open_path(path)

    def open_note(self, name: str) -> OpenedNote:
        with self._lock:
            return self._open_path(self._note_path(name))

    def save_note(
        self,
        name: str,
        content: str,
        expected_revision: str,
        *,
        has_bom: bool,
        newline: str,
        force: bool = False,
    ) -> SaveResult:
        path = self._note_path(name)
        with self._lock:
            if not path.is_file():
                return SaveResult(status="missing")
            try:
                current_data = path.read_bytes()
            except OSError as error:
                raise UserVisibleError(message(
                    f'Couldn\'t read “{name}”: {error}', f"无法读取“{name}”：{error}"
                )) from error

            current_revision = content_revision(current_data)
            if not force and current_revision != expected_revision:
                external, external_bom, external_newline = _decode_utf8(current_data, name)
                return SaveResult(
                    status="conflict",
                    revision=current_revision,
                    external_content=external,
                    has_bom=external_bom,
                    newline=external_newline,
                )

            encoded = _encode_utf8(content, has_bom, newline)
            if encoded == current_data:
                return SaveResult(status="unchanged", revision=current_revision)

            self._atomic_write(path, encoded)
            return SaveResult(status="saved", revision=content_revision(encoded))

    def recreate_note(
        self,
        name: str,
        content: str,
        *,
        has_bom: bool,
        newline: str,
    ) -> OpenedNote:
        path = self._note_path(name)
        with self._lock:
            if path.exists():
                raise UserVisibleError(message(
                    f'“{name}” has reappeared. Return home and open it again.',
                    f"“{name}”已经重新出现，请返回主页后再打开。",
                ))
            encoded = _encode_utf8(content, has_bom, newline)
            try:
                with path.open("xb") as stream:
                    stream.write(encoded)
                    stream.flush()
                    os.fsync(stream.fileno())
            except OSError as error:
                raise UserVisibleError(message(
                    f'Couldn\'t recreate “{name}”: {error}',
                    f"重新创建“{name}”失败：{error}",
                )) from error
            return self._open_path(path)

    def archive_note(self, name: str) -> str:
        source = self._note_path(name)
        with self._lock:
            if not source.is_file():
                raise UserVisibleError(message(
                    f'The note “{name}” no longer exists.', f"记录“{name}”已经不存在。"
                ))
            archive_dir = self.root / ARCHIVE_DIRECTORY
            try:
                archive_dir.mkdir(exist_ok=True)
                target = self._unique_path(archive_dir, source.name)
                os.replace(source, target)
            except OSError as error:
                raise UserVisibleError(message(
                    f"Couldn't archive the note: {error}", f"归档失败：{error}"
                )) from error
            return target.name

    def restore_archived_note(self, name: str) -> str:
        source = self._archived_note_path(name)
        with self._lock:
            if not source.is_file():
                raise UserVisibleError(message(
                    f'The archived note “{name}” no longer exists.',
                    f"归档记录“{name}”已经不存在",
                ))
            try:
                target = self._unique_path(self.root, source.name)
                os.replace(source, target)
            except OSError as error:
                raise UserVisibleError(message(
                    f"Couldn't restore the note: {error}", f"还原失败：{error}"
                )) from error
            return target.name

    def delete_archived_note(self, name: str, trash_file: Callable[[Path], None]) -> None:
        source = self._archived_note_path(name)
        with self._lock:
            if not source.is_file():
                raise UserVisibleError(message(
                    f'The archived note “{name}” no longer exists.',
                    f"归档记录“{name}”已经不存在",
                ))
            try:
                trash_file(source)
            except OSError as error:
                raise UserVisibleError(message(
                    f"Couldn't delete the note: {error}", f"删除失败：{error}"
                )) from error

    def _open_path(self, path: Path) -> OpenedNote:
        try:
            data = path.read_bytes()
        except FileNotFoundError as error:
            raise UserVisibleError(message(
                f'The note “{path.name}” no longer exists.',
                f"记录“{path.name}”已经不存在。",
            )) from error
        except OSError as error:
            raise UserVisibleError(message(
                f'Couldn\'t open “{path.name}”: {error}',
                f"无法打开“{path.name}”：{error}",
            )) from error
        text, has_bom, newline = _decode_utf8(data, path.name)
        return OpenedNote(path.name, text, content_revision(data), has_bom, newline)

    def _note_path(self, name: str) -> Path:
        if not name or name != Path(name).name or Path(name).suffix.lower() != ".md":
            raise UserVisibleError(message("The note filename is invalid.", "记录文件名无效。"))
        candidate = self.root / name
        if candidate.parent.resolve() != self.root:
            raise UserVisibleError(message(
                "The note path is outside the storage folder.", "记录路径超出保存目录。"
            ))
        return candidate

    def _archived_note_path(self, name: str) -> Path:
        if not name or name != Path(name).name or Path(name).suffix.lower() != ".md":
            raise UserVisibleError(message(
                "The archived note filename is invalid.", "归档记录文件名无效"
            ))
        archive_dir = self.root / ARCHIVE_DIRECTORY
        if archive_dir.is_symlink():
            raise UserVisibleError(message("The archive folder is invalid.", "归档目录无效"))
        candidate = archive_dir / name
        if candidate.parent.resolve() != archive_dir.resolve():
            raise UserVisibleError(message(
                "The archived note path is outside the archive folder.",
                "归档记录路径超出归档目录",
            ))
        return candidate

    def _migrate_legacy_archive_directory(self) -> None:
        legacy = self.root / _LEGACY_ARCHIVE_DIRECTORY
        archive = self.root / ARCHIVE_DIRECTORY
        if not legacy.is_dir() or legacy.is_symlink():
            return
        try:
            if not archive.exists():
                os.replace(legacy, archive)
                return
            if not archive.is_dir() or archive.is_symlink():
                raise OSError(f"{archive} is not a valid directory")
            for entry in os.scandir(legacy):
                source = Path(entry.path)
                target = self._unique_path(archive, entry.name)
                os.replace(source, target)
            legacy.rmdir()
        except OSError as error:
            raise UserVisibleError(message(
                f"Couldn't migrate the legacy archive folder: {error}",
                f"无法迁移旧归档目录：{error}",
            )) from error

    def _safe_filename(self, requested_name: str) -> str:
        value = requested_name.strip()
        if value.lower().endswith(".md"):
            value = value[:-3]
        value = _INVALID_FILENAME.sub("-", value).strip().rstrip(". ")
        if not value:
            value = date.today().isoformat()
        if value.split(".", 1)[0].upper() in _RESERVED_NAMES:
            value = f"{value}-"
        value = value[:100].rstrip(". ") or date.today().isoformat()
        return f"{value}.md"

    @staticmethod
    def _unique_path(directory: Path, filename: str) -> Path:
        existing = {entry.name.casefold() for entry in os.scandir(directory)}
        candidate = filename
        stem = Path(filename).stem
        suffix = Path(filename).suffix
        index = 2
        while candidate.casefold() in existing:
            candidate = f"{stem} ({index}){suffix}"
            index += 1
        return directory / candidate

    @staticmethod
    def _atomic_write(path: Path, data: bytes) -> None:
        temp_path: Path | None = None
        try:
            descriptor, raw_temp_path = tempfile.mkstemp(
                prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
            )
            temp_path = Path(raw_temp_path)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_path, path)
        except OSError as error:
            raise UserVisibleError(message(
                f'Couldn\'t save “{path.name}”: {error}',
                f"保存“{path.name}”失败：{error}",
            )) from error
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
