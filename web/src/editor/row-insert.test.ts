import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";

import { rowInsertPlugin } from "./row-insert";
import { noteSchema } from "./schema";

describe("row insertion gaps", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it("shows one gap before non-initial headings and at the bottom", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("first")),
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("Title")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("last")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowInsertPlugin()] }),
    });

    const buttons = host.querySelectorAll<HTMLButtonElement>(".row-insert-button");
    expect(buttons).toHaveLength(2);
    buttons[0]!.click();
    expect(Array.from(view.state.doc.content.content, (node) => ({
      type: node.type.name,
      text: node.textContent,
    }))).toEqual([
      { type: "paragraph", text: "first" },
      { type: "paragraph", text: "" },
      { type: "heading", text: "Title" },
      { type: "paragraph", text: "last" },
    ]);
  });

  it("does not show a top gap when the first line is a heading", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("Title")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("body")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowInsertPlugin()] }),
    });

    expect(host.querySelectorAll(".row-insert-button")).toHaveLength(1);
  });

  it("hides the bottom gap when the final paragraph is already blank", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("body")),
      noteSchema.nodes.paragraph.create(),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowInsertPlugin()] }),
    });

    expect(host.querySelector(".row-insert-button")).toBeNull();
  });

  it("hides the bottom gap when the final list item is already blank", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const list = noteSchema.nodes.bullet_list.create(null, [
      noteSchema.nodes.list_item.create(
        { checked: null },
        noteSchema.nodes.paragraph.create(null, noteSchema.text("item")),
      ),
      noteSchema.nodes.list_item.create(
        { checked: null },
        noteSchema.nodes.paragraph.create(),
      ),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({
        doc: noteSchema.nodes.doc.create(null, list),
        plugins: [rowInsertPlugin()],
      }),
    });

    expect(host.querySelector(".row-insert-button")).toBeNull();
  });

  it.each([
    ["bullet", "bullet_list", null],
    ["ordered", "ordered_list", null],
    ["task", "bullet_list", false],
  ] as const)("continues a %s list when its bottom gap is clicked", (_kind, nodeName, checked) => {
    const host = document.createElement("div");
    document.body.append(host);
    const item = noteSchema.nodes.list_item.create(
      { checked: _kind === "task" ? true : null },
      noteSchema.nodes.paragraph.create(null, noteSchema.text("item")),
    );
    const list = noteSchema.nodes[nodeName].create(null, item);
    const doc = noteSchema.nodes.doc.create(null, list);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowInsertPlugin()] }),
    });

    const button = host.querySelector<HTMLButtonElement>(".row-insert-button")!;
    button.click();

    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.firstChild?.type.name).toBe(nodeName);
    expect(view.state.doc.firstChild?.childCount).toBe(2);
    expect(view.state.doc.firstChild?.lastChild?.attrs.checked).toBe(checked);
    expect(view.state.selection.$from.parent.type).toBe(noteSchema.nodes.paragraph);
    expect(view.state.selection.$from.parent.content.size).toBe(0);
  });
});
