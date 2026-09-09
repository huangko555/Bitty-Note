from __future__ import annotations

import re
from dataclasses import dataclass

from .models import NoteBackground

DEFAULT_NOTE_BACKGROUND: NoteBackground = "default"
NOTE_BACKGROUNDS: tuple[NoteBackground, ...] = (
    "default",
    "sand",
    "peach",
    "rose",
    "lavender",
    "sky",
    "mint",
    "gray",
)
_BACKGROUND_LINE = re.compile(
    r"^(?P<indent>[ \t]*)bitty-background[ \t]*:[ \t]*"
    r"(?P<value>[^#\n]*?)[ \t]*(?:#.*)?$"
)
_LEADING_BLANK_LINES = re.compile(r"^(?:[ \t]*\n)+")


@dataclass(frozen=True)
class NoteDocument:
    content: str
    background: NoteBackground = DEFAULT_NOTE_BACKGROUND
    front_matter: str | None = None


def validate_note_background(value: str) -> NoteBackground:
    if value not in NOTE_BACKGROUNDS:
        raise ValueError(f"Unsupported note background: {value}")
    return value


def parse_note_document(text: str) -> NoteDocument:
    """Separate Bitty metadata from the body shown in the application."""
    if not text.startswith("---\n"):
        return NoteDocument(content=text)

    lines = text.splitlines(keepends=True)
    closing_index: int | None = None
    for index, line in enumerate(lines[1:], start=1):
        if line.removesuffix("\n") == "---":
            closing_index = index
            break
    if closing_index is None:
        return NoteDocument(content=text)

    front_matter = "".join(lines[1:closing_index])
    body = "".join(lines[closing_index + 1 :])
    body = _LEADING_BLANK_LINES.sub("", body)
    background: NoteBackground = DEFAULT_NOTE_BACKGROUND
    for line in front_matter.splitlines():
        match = _BACKGROUND_LINE.match(line)
        if match is None:
            continue
        raw_value = match.group("value").strip()
        if len(raw_value) >= 2 and raw_value[0] == raw_value[-1] \
                and raw_value[0] in {'"', "'"}:
            raw_value = raw_value[1:-1]
        if raw_value in NOTE_BACKGROUNDS:
            background = raw_value
        break
    return NoteDocument(
        content=body,
        background=background,
        front_matter=front_matter,
    )


def render_note_document(
    document: NoteDocument,
    content: str,
    background: str,
) -> str:
    """Merge the edited body and Bitty metadata without losing other keys."""
    normalized_background = validate_note_background(background)
    if document.front_matter is None:
        if normalized_background == DEFAULT_NOTE_BACKGROUND:
            return content
        suffix = f"\n{content}" if content else ""
        return f"---\nbitty-background: {normalized_background}\n---\n{suffix}"

    output_lines: list[str] = []
    background_written = False
    for line in document.front_matter.splitlines(keepends=True):
        bare_line = line.removesuffix("\n")
        match = _BACKGROUND_LINE.match(bare_line)
        if match is None:
            output_lines.append(line)
            continue
        existing_value = match.group("value").strip()
        if len(existing_value) >= 2 and existing_value[0] == existing_value[-1] \
                and existing_value[0] in {'"', "'"}:
            existing_value = existing_value[1:-1]
        if existing_value not in NOTE_BACKGROUNDS \
                and normalized_background == DEFAULT_NOTE_BACKGROUND:
            output_lines.append(line)
            continue
        if normalized_background != DEFAULT_NOTE_BACKGROUND and not background_written:
            output_lines.append(f"{match.group('indent')}bitty-background: "
                                f"{normalized_background}\n")
            background_written = True

    if normalized_background != DEFAULT_NOTE_BACKGROUND and not background_written:
        if output_lines and not output_lines[-1].endswith("\n"):
            output_lines[-1] += "\n"
        output_lines.append(f"bitty-background: {normalized_background}\n")

    front_matter = "".join(output_lines)
    if not front_matter.strip():
        return content
    if not front_matter.endswith("\n"):
        front_matter += "\n"
    suffix = f"\n{content}" if content else ""
    return f"---\n{front_matter}---\n{suffix}"
