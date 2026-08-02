from pathlib import Path

import pytest

from desktop_notes.errors import UserVisibleError
from desktop_notes.repository import NotesRepository


def test_recreate_uses_the_original_name_without_deduplicating(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)
    note = repository.create_note("记录")
    (tmp_path / note.name).unlink()

    recreated = repository.recreate_note(
        note.name,
        "恢复内容",
        has_bom=False,
        newline="\n",
    )

    assert recreated.name == "记录.md"
    assert recreated.content == "恢复内容"


def test_recreate_refuses_to_overwrite_a_reappeared_file(tmp_path: Path) -> None:
    repository = NotesRepository(tmp_path)
    note = repository.create_note("记录")

    with pytest.raises(UserVisibleError):
        repository.recreate_note(note.name, "覆盖", has_bom=False, newline="\n")
