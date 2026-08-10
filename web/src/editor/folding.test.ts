import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(button.classList.contains("is-collapsed")).toBe(false);
    button.click();

    expect(view.state.doc.firstChild?.attrs.collapsed).toBe(true);
    expect(host.querySelector(".fold-toggle")?.classList.contains("is-collapsed")).toBe(true);
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

  it("keeps the editor viewport stable across repeated fold toggles", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create(
        { level: 1, collapsed: false },
        noteSchema.text("标题"),
      ),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("正文一")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("正文二")),
    ]);
    const mockHeadingRect = () => {
      const heading = host.querySelector("h1");
      if (!heading) return;
      vi.spyOn(heading, "getBoundingClientRect").mockImplementation(() => ({
        top: 100 - host.scrollTop,
        bottom: 122 - host.scrollTop,
      }) as DOMRect);
    };
    let editor!: EditorView;
    editor = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [foldingPlugin()] }),
      dispatchTransaction: (transaction) => {
        editor.updateState(editor.state.apply(transaction));
        mockHeadingRect();
        // WebView scroll anchoring can adjust the viewport after folded DOM changes.
        host.scrollTop -= 20;
      },
    });
    view = editor;
    host.scrollTop = 240;
    mockHeadingRect();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    for (let count = 0; count < 4; count += 1) {
      host.querySelector<HTMLButtonElement>(".fold-toggle")!.click();
    }

    expect(host.scrollTop).toBe(240);
  });
});
