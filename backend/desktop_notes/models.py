from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class NoteSummary:
    name: str
    preview: str
    modified_ms: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class OpenedNote:
    name: str
    content: str
    revision: str
    has_bom: bool
    newline: Literal["\n", "\r\n"]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SaveResult:
    status: Literal["saved", "unchanged", "conflict", "missing"]
    revision: str | None = None
    external_content: str | None = None
    has_bom: bool = False
    newline: Literal["\n", "\r\n"] = "\n"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class MigrationResult:
    copied_count: int
    recycled_count: int
    retained_files: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["retained_files"] = list(self.retained_files)
        return data
