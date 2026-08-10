import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";

import { foldingPlugin } from "./folding";
import { serializeMarkdown } from "./markdown";
import { noteSchema } from "./schema";

describe("folding", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it("folds a heading section and persists the state", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create(
        { level: 1, collapsed: false },
        noteSchema.text("标题"),
      ),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("正文")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [foldingPlugin()] }),
    });

    const button = host.querySelector<HTMLButtonElement>(".fold-toggle")!;
    button.click();

    expect(view.state.doc.firstChild?.attrs.collapsed).toBe(true);
    expect(host.querySelector("p")?.classList.contains("is-folded-content")).toBe(true);
    expect(serializeMarkdown(view.state.doc)).toContain("# <!-- bitty-folded --> 标题");
  });

  it("folds only the descendants of a list item", () => {
    const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
      null,
      noteSchema.text(text),
    );
    const child = noteSchema.nodes.list_item.create(
      { checked: null, collapsed: false },
      paragraph("子项"),
    );
    const parent = noteSchema.nodes.list_item.create(
      { checked: null, collapsed: false },
      [paragraph("父项"), noteSchema.nodes.bullet_list.create(null, child)],
    );
    const doc = noteSchema.nodes.doc.create(
      null,
      noteSchema.nodes.bullet_list.create(null, parent),
    );
    const host = document.createElement("div");
    document.body.append(host);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [foldingPlugin()] }),
    });

    host.querySelector<HTMLButtonElement>(".fold-toggle")!.click();

    const parentDom = host.querySelector("li")!;
    expect(parentDom.classList.contains("is-collapsed-list-item")).toBe(true);
    expect(parentDom.querySelector(":scope > p")?.textContent).toContain("父项");
  });
});
