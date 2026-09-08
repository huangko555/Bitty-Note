from desktop_notes.note_document import parse_note_document, render_note_document


def test_front_matter_is_hidden_with_following_blank_lines() -> None:
    source = "---\ntitle: 保留\nbitty-background: sand\n---\n\n  \n正文\n"

    document = parse_note_document(source)

    assert document.content == "正文\n"
    assert document.background == "sand"
    assert document.front_matter == "title: 保留\nbitty-background: sand\n"


def test_malformed_front_matter_remains_visible_markdown() -> None:
    source = "---\nbitty-background: rose\n正文"

    document = parse_note_document(source)

    assert document.content == source
    assert document.background == "default"
    assert document.front_matter is None


def test_render_preserves_other_properties_and_replaces_background() -> None:
    document = parse_note_document(
        "---\ntitle: 示例\nbitty-background: sand # old\ntags: [one]\n---\n\n正文"
    )

    rendered = render_note_document(document, "新正文", "sky")

    assert rendered == (
        "---\ntitle: 示例\nbitty-background: sky\ntags: [one]\n---\n\n新正文"
    )


def test_default_removes_only_bitty_front_matter_when_empty() -> None:
    document = parse_note_document("---\nbitty-background: mint\n---\n\n正文")

    assert render_note_document(document, "正文", "default") == "正文"


def test_unknown_background_is_hidden_but_preserved_until_changed() -> None:
    source = "---\nbitty-background: future-color\ncustom: value\n---\n\n正文"
    document = parse_note_document(source)

    assert document.background == "default"
    assert render_note_document(document, document.content, "default") == source
