import { TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { describe, expect, it, vi } from "vitest";

import { createEditor } from "./editor";

describe("native input and deletion", () => {
  it("keeps digit input and deletion after opening an empty note first", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onChange = vi.fn();
    const { controller } = createEditor(host, "", {
      onChange,
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const view = (controller as unknown as { view: EditorView }).view;
    view.setProps({ handleScrollToSelection: () => true });
    view.focus();
    try {
      const paragraph = view.dom.querySelector("p")!;
      const observer = (view as unknown as { domObserver: { flush(): void } }).domObserver;
      for (const value of ["1", "12", "123", "12", "1", "", "4", "456"]) {
        if (!(paragraph.firstChild instanceof Text)) {
          paragraph.prepend(document.createTextNode(""));
        }
        const text = paragraph.firstChild as Text;
        text.data = value;
        document.getSelection()!.collapse(text, value.length);
        observer.flush();
        expect(view.state.doc.textContent).toBe(value);
        const saved = value ? `${value}\n` : "<!-- bitty-empty-line -->\n";
        expect(controller.getMarkdown()).toBe(saved);
        expect(onChange).toHaveBeenLastCalledWith(saved);
      }
    } finally {
      controller.destroy();
      host.remove();
      vi.restoreAllMocks();
    }
  });

  it.each(["", "已有文字\n", "- [ ] 内容\n", "# 标题\n\n<!-- bitty-empty-line -->\n"])(
    "keeps composing text in a note starting with %j",
    (markdown) => {
      const host = document.createElement("div");
      document.body.append(host);
      const { controller } = createEditor(host, markdown, {
        onChange: () => {},
        onFocusChange: () => {},
        onSelectionChange: () => {},
      });
      const view = (controller as unknown as { view: EditorView }).view;
      view.setProps({ handleScrollToSelection: () => true });
      view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
      view.focus();
      view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      try {
        const { node, offset } = view.domAtPos(view.state.selection.head);
        const text = document.createTextNode("");
        if (node.nodeType === Node.TEXT_NODE) {
          (node as Text).splitText(offset).before(text);
        } else {
          node.insertBefore(text, node.childNodes[offset] ?? null);
        }
        const observer = (view as unknown as { domObserver: { flush(): void } }).domObserver;
        for (const value of ["m", "mei", "没有", "没有停下输入"]) {
          text.data = value;
          document.getSelection()!.collapse(text, value.length);
          view.dom.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: value }));
          observer.flush();
          expect(text.isConnected).toBe(true);
          expect(view.state.doc.textContent).toContain(value);
          expect(controller.getMarkdown()).toContain(value);
        }
      } finally {
        view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        controller.destroy();
        host.remove();
        vi.restoreAllMocks();
      }
    },
  );
});
