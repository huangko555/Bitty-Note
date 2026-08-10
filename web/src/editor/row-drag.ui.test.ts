import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { foldingPlugin } from "./folding";
import { rowDragPlugin } from "./row-drag";
import { rowInsertPlugin } from "./row-insert";
import { noteSchema } from "./schema";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe("row drag handle", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("keeps the handle fixed and highlights only while using it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("缩进内容")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });

    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    const paragraph = view.dom.querySelector("p")!;
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 22));
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));

    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const highlight = host.querySelector<HTMLElement>(".block-row-handle-highlight")!;
    const preview = host.querySelector<HTMLElement>(".block-drag-preview")!;
    expect(handle.classList.contains("visible")).toBe(true);
    expect(handle.style.left).toBe("13px");
    expect(host.querySelector(".block-row-highlight")).toBeNull();
    expect(highlight.classList.contains("visible")).toBe(false);

    handle.dispatchEvent(new MouseEvent("pointerenter"));
    expect(highlight.classList.contains("visible")).toBe(true);
    expect(highlight.style.left).toBe("13px");
    view.updateState(view.state);
    expect(handle.classList.contains("visible")).toBe(true);
    expect(highlight.classList.contains("visible")).toBe(true);
    handle.dispatchEvent(new MouseEvent("pointerleave"));
    expect(highlight.classList.contains("visible")).toBe(false);

    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    handle.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 100,
      clientY: 50,
    }));
    expect(highlight.classList.contains("visible")).toBe(true);
    expect(preview.classList.contains("visible")).toBe(true);
    expect(preview.firstElementChild?.classList.contains("block-drag-preview-handle")).toBe(true);
    expect(preview.querySelector(".block-drag-preview-text")?.textContent).toBe("缩进内容");
    expect(preview.style.left).toBe("96px");
    expect(preview.style.top).toBe("32px");
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    expect(highlight.classList.contains("visible")).toBe(false);
    expect(preview.classList.contains("visible")).toBe(false);
  });

  it("highlights a heading and its complete section as one block", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("章节")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("章节正文")),
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("下一章节")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    const headings = view.dom.querySelectorAll("h1");
    const paragraph = view.dom.querySelector("p")!;
    vi.spyOn(headings[0]!, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 25));
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(rect(80, 55, 200, 22));
    vi.spyOn(headings[1]!, "getBoundingClientRect").mockReturnValue(rect(80, 90, 200, 25));
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const highlight = host.querySelector<HTMLElement>(".block-row-handle-highlight")!;
    handle.dispatchEvent(new MouseEvent("pointerenter"));

    expect(highlight.classList.contains("visible")).toBe(true);
    expect(highlight.style.top).toBe("18px");
    expect(highlight.style.height).toBe("61px");
  });

  it("highlights the complete affected block when a fold toggle is hovered", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("章节")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("章节正文")),
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("下一章节")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin(), foldingPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    const headings = view.dom.querySelectorAll("h1");
    const paragraph = view.dom.querySelector("p")!;
    vi.spyOn(headings[0]!, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 25));
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(rect(80, 55, 200, 22));
    vi.spyOn(headings[1]!, "getBoundingClientRect").mockReturnValue(rect(80, 90, 200, 25));

    const button = host.querySelector<HTMLButtonElement>(".fold-toggle")!;
    const highlight = host.querySelector<HTMLElement>(".block-row-handle-highlight")!;
    button.dispatchEvent(new MouseEvent("pointerenter"));

    expect(highlight.classList.contains("visible")).toBe(true);
    expect(highlight.style.top).toBe("43px");
    expect(highlight.style.width).toBe("267px");
    expect(highlight.style.height).toBe("36px");

    button.dispatchEvent(new MouseEvent("pointerleave"));
    expect(highlight.classList.contains("visible")).toBe(false);

    button.click();
    vi.spyOn(view.dom.querySelector("h1")!, "getBoundingClientRect")
      .mockReturnValue(rect(80, 20, 200, 25));
    const collapsedButton = host.querySelector<HTMLButtonElement>(".fold-toggle")!;
    collapsedButton.dispatchEvent(new MouseEvent("pointerenter"));
    expect(highlight.classList.contains("visible")).toBe(false);

    collapsedButton.dispatchEvent(new MouseEvent("pointerleave"));
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });
    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));
    host.querySelector<HTMLElement>(".block-drag-handle")!
      .dispatchEvent(new MouseEvent("pointerenter"));
    expect(highlight.classList.contains("visible")).toBe(true);
    expect(highlight.style.height).toBe("29px");
  });

  it("highlights a list item and its indented children as one block", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
      null,
      noteSchema.text(text),
    );
    const child = noteSchema.nodes.list_item.create({ checked: null }, paragraph("子项"));
    const nested = noteSchema.nodes.bullet_list.create(null, child);
    const parent = noteSchema.nodes.list_item.create(
      { checked: null },
      [paragraph("父项"), nested],
    );
    const doc = noteSchema.nodes.doc.create(
      null,
      noteSchema.nodes.bullet_list.create(null, parent),
    );
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    const listItem = view.dom.querySelector("li")!;
    const parentParagraph = listItem.querySelector(":scope > p")!;
    vi.spyOn(listItem, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 70));
    vi.spyOn(parentParagraph, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 22));
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 2, inside: 1 });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const highlight = host.querySelector<HTMLElement>(".block-row-handle-highlight")!;
    handle.dispatchEvent(new MouseEvent("pointerenter"));

    expect(highlight.classList.contains("visible")).toBe(true);
    expect(highlight.style.left).toBe("13px");
    expect(highlight.style.top).toBe("18px");
    expect(highlight.style.height).toBe("74px");
  });

  it("moves the active handle and highlight with their source while scrolling", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("拖动内容")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("目标内容")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    const paragraph = view.dom.querySelector("p")!;
    vi.spyOn(paragraph, "getBoundingClientRect").mockImplementation(
      () => rect(80, 60 - host.scrollTop, 200, 22),
    );
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 70,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const highlight = host.querySelector<HTMLElement>(".block-row-handle-highlight")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(handle.style.top).toBe("60px");
    expect(highlight.style.top).toBe("58px");

    host.scrollTop = 30;
    host.dispatchEvent(new Event("scroll"));

    expect(handle.style.top).toBe("30px");
    expect(highlight.style.top).toBe("28px");

    host.scrollTop = 100;
    host.dispatchEvent(new Event("scroll"));
    expect(highlight.classList.contains("visible")).toBe(false);

    host.scrollTop = 0;
    host.dispatchEvent(new Event("scroll"));
    expect(highlight.classList.contains("visible")).toBe(true);
  });

  it("scrolls the editor when the wheel is used over the drag handle", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("可滚动内容")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    host.scrollTop = 12;
    const scrollBy = vi.fn();
    Object.defineProperty(host, "scrollBy", { value: scrollBy });
    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 36,
    });

    handle.dispatchEvent(wheel);

    expect(scrollBy).toHaveBeenCalledWith({ top: 36, behavior: "smooth" });
    expect(host.scrollTop).toBe(12);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it.each(["paragraph", "list"] as const)(
    "keeps a terminal empty %s row to one line and treats its tail as ordinary after",
    (kind) => {
      const host = document.createElement("div");
      document.body.append(host);
      const source = noteSchema.nodes.paragraph.create(null, noteSchema.text("移动内容"));
      const retained = noteSchema.nodes.paragraph.create(null, noteSchema.text("保留内容"));
      const empty = noteSchema.nodes.paragraph.create();
      const finalNode = kind === "paragraph"
        ? empty
        : noteSchema.nodes.bullet_list.create(
          null,
          noteSchema.nodes.list_item.create({ checked: null }, empty),
        );
      const doc = noteSchema.nodes.doc.create(null, [source, retained, finalNode]);
      view = new EditorView(host, {
        state: EditorState.create({
          doc,
          plugins: [rowDragPlugin(), rowInsertPlugin()],
        }),
      });
      vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 180));
      vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 180));
      const paragraphs = view.dom.querySelectorAll("p");
      const sourceDom = paragraphs[0]!;
      const emptyDom = paragraphs[2]!;
      expect(emptyDom.classList.contains("is-terminal-empty-line")).toBe(true);
      const posAtDOM = view.posAtDOM.bind(view);
      vi.spyOn(view, "posAtDOM").mockImplementation((node, offset, bias) => {
        if (node === emptyDom) throw new Error("terminal empty DOM maps to a node boundary");
        return posAtDOM(node, offset, bias);
      });
      vi.spyOn(sourceDom, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 22));
      vi.spyOn(emptyDom, "getBoundingClientRect").mockReturnValue(rect(80, 60, 200, 120));
      if (kind === "list") {
        vi.spyOn(view.dom.querySelector("li")!, "getBoundingClientRect")
          .mockReturnValue(rect(80, 60, 200, 120));
        vi.spyOn(view.dom.querySelector("ul")!, "getBoundingClientRect")
          .mockReturnValue(rect(50, 60, 230, 120));
      }
      let emptyPosition = -1;
      doc.descendants((node, position) => {
        if (node === empty) emptyPosition = position;
        return emptyPosition < 0;
      });
      vi.spyOn(view, "posAtCoords").mockImplementation(({ top }) => top < 50
        ? { pos: 1, inside: 0 }
        : top <= 104
          ? { pos: emptyPosition + 1, inside: emptyPosition }
          : null);
      const pointerEvent = (type: string, y: number) => {
        const event = new MouseEvent(type, {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: y,
        });
        Object.defineProperty(event, "pointerId", { value: 32 });
        return event;
      };

      host.dispatchEvent(pointerEvent("pointermove", 70));
      const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
      const highlight = host.querySelector<HTMLElement>(".block-row-handle-highlight")!;
      handle.dispatchEvent(new MouseEvent("pointerenter"));
      expect(highlight.style.height).toBe("25px");

      host.dispatchEvent(pointerEvent("pointermove", 95));
      expect(handle.classList.contains("visible")).toBe(false);

      host.dispatchEvent(pointerEvent("pointermove", 30));
      Object.defineProperties(handle, {
        setPointerCapture: { value: vi.fn() },
        hasPointerCapture: { value: vi.fn(() => false) },
      });
      handle.dispatchEvent(pointerEvent("pointerdown", 30));
      window.dispatchEvent(pointerEvent("pointermove", 185));
      const indicator = host.querySelector<HTMLElement>(".block-drop-indicator")!;
      expect(indicator.classList.contains("visible")).toBe(true);
      expect(indicator.style.top).toBe("80px");
      window.dispatchEvent(pointerEvent("pointerup", 185));
      expect(view.state.doc.child(0).textContent).toBe("保留内容");
      if (kind === "paragraph") {
        expect(view.state.doc.child(1).content.size).toBe(0);
        expect(view.state.doc.child(2).textContent).toBe("移动内容");
      } else {
        const list = view.state.doc.child(1);
        expect(list.childCount).toBe(2);
        expect(list.child(0).firstChild?.content.size).toBe(0);
        expect(list.child(1).textContent).toBe("移动内容");
      }
      let emptyTextblocks = 0;
      view.state.doc.descendants((node) => {
        if (node.isTextblock && node.content.size === 0) emptyTextblocks += 1;
      });
      expect(emptyTextblocks).toBe(1);
    },
  );

  it("snaps a heading dragged over section content to the section bottom", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const heading = (text: string) => noteSchema.nodes.heading.create(
      { level: 1 },
      noteSchema.text(text),
    );
    const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
      null,
      noteSchema.text(text),
    );
    const doc = noteSchema.nodes.doc.create(null, [
      heading("源标题"),
      paragraph("源正文"),
      heading("目标标题"),
      paragraph("目标正文一"),
      paragraph("目标正文二"),
      heading("末尾标题"),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 220));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 220));
    const headings = view.dom.querySelectorAll("h1");
    const paragraphs = view.dom.querySelectorAll("p");
    vi.spyOn(headings[0]!, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 22));
    vi.spyOn(paragraphs[0]!, "getBoundingClientRect").mockReturnValue(rect(80, 50, 200, 22));
    vi.spyOn(headings[1]!, "getBoundingClientRect").mockReturnValue(rect(80, 90, 200, 22));
    vi.spyOn(paragraphs[1]!, "getBoundingClientRect").mockReturnValue(rect(80, 120, 200, 22));
    vi.spyOn(paragraphs[2]!, "getBoundingClientRect").mockReturnValue(rect(80, 150, 200, 22));
    vi.spyOn(headings[2]!, "getBoundingClientRect").mockReturnValue(rect(80, 190, 200, 22));
    let targetPosition = -1;
    doc.descendants((node, position) => {
      if (node.type === noteSchema.nodes.paragraph && node.textContent === "目标正文一") {
        targetPosition = position;
        return false;
      }
      return targetPosition < 0;
    });
    vi.spyOn(view, "posAtCoords").mockImplementation(({ top }) => top < 80
      ? { pos: 1, inside: 0 }
      : { pos: targetPosition + 1, inside: targetPosition });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const indicator = host.querySelector<HTMLElement>(".block-drop-indicator")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    const pointerEvent = (type: string, clientY: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY,
      });
      Object.defineProperty(event, "pointerId", { value: 14 });
      return event;
    };

    handle.dispatchEvent(pointerEvent("pointerdown", 30));
    window.dispatchEvent(pointerEvent("pointermove", 130));

    expect(indicator.classList.contains("visible")).toBe(true);
    expect(indicator.style.top).toBe("171px");
    window.dispatchEvent(pointerEvent("pointermove", 160));
    expect(indicator.style.top).toBe("171px");
    window.dispatchEvent(pointerEvent("pointercancel", 130));
  });

  it("hides a list drop indicator when the row is already at that boundary", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
      null,
      noteSchema.text(text),
    );
    const item = (text: string, children: readonly ReturnType<typeof noteSchema.nodes.bullet_list.create>[] = []) =>
      noteSchema.nodes.list_item.create({ checked: null }, [paragraph(text), ...children]);
    const parent = item("父项", [noteSchema.nodes.bullet_list.create(null, item("子项"))]);
    const source = item("移动项");
    const doc = noteSchema.nodes.doc.create(
      null,
      noteSchema.nodes.bullet_list.create(null, [parent, source]),
    );
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 220));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 220));
    const listItems = view.dom.querySelectorAll("li");
    const paragraphs = view.dom.querySelectorAll("p");
    vi.spyOn(listItems[0]!, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 70));
    vi.spyOn(paragraphs[0]!, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 22));
    vi.spyOn(listItems[2]!, "getBoundingClientRect").mockReturnValue(rect(80, 110, 200, 22));
    vi.spyOn(paragraphs[2]!, "getBoundingClientRect").mockReturnValue(rect(80, 110, 200, 22));
    let parentPosition = -1;
    let sourcePosition = -1;
    doc.descendants((node, position) => {
      if (node.type !== noteSchema.nodes.list_item) return true;
      if (node.firstChild?.textContent === "父项") parentPosition = position;
      if (node.firstChild?.textContent === "移动项") sourcePosition = position;
      return true;
    });
    vi.spyOn(view, "posAtCoords").mockImplementation(({ top }) => top > 100
      ? { pos: sourcePosition + 1, inside: sourcePosition }
      : { pos: parentPosition + 1, inside: parentPosition });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 120,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const indicator = host.querySelector<HTMLElement>(".block-drop-indicator")!;
    const insideIndicator = host.querySelector<HTMLElement>(".block-drop-inside-indicator")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    const pointerEvent = (type: string, clientY: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY,
      });
      Object.defineProperty(event, "pointerId", { value: 15 });
      return event;
    };

    handle.dispatchEvent(pointerEvent("pointerdown", 120));
    window.dispatchEvent(pointerEvent("pointermove", 40));

    expect(indicator.classList.contains("visible")).toBe(false);
    expect(insideIndicator.classList.contains("visible")).toBe(false);
    window.dispatchEvent(pointerEvent("pointercancel", 40));

    host.dispatchEvent(pointerEvent("pointermove", 120));
    handle.dispatchEvent(pointerEvent("pointerdown", 120));
    window.dispatchEvent(pointerEvent("pointermove", 31));

    expect(indicator.classList.contains("visible")).toBe(false);
    expect(insideIndicator.classList.contains("visible")).toBe(true);
    expect(insideIndicator.style.left).toBe("49.6px");
    expect(insideIndicator.style.top).toBe("17px");
    expect(insideIndicator.style.height).toBe("76px");
    window.dispatchEvent(pointerEvent("pointercancel", 31));
  });

  it("uses one guide-line inset for a shared heading and list boundary", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
      null,
      noteSchema.text(text),
    );
    const item = (text: string, checked: boolean | null) =>
      noteSchema.nodes.list_item.create({ checked }, paragraph(text));
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("标题")),
      noteSchema.nodes.bullet_list.create(null, item("圆点", null)),
      noteSchema.nodes.ordered_list.create({ order: 1 }, item("序号", null)),
      noteSchema.nodes.bullet_list.create(null, item("勾选目标", false)),
      noteSchema.nodes.bullet_list.create(null, item("勾选源", false)),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 240));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 240));
    const heading = view.dom.querySelector("h1")!;
    vi.spyOn(heading, "getBoundingClientRect").mockReturnValue(rect(10, 20, 300, 22));
    const lists = view.dom.querySelectorAll("ul, ol");
    const listItems = view.dom.querySelectorAll("li");
    const paragraphs = view.dom.querySelectorAll("p");
    [60, 100, 140, 180].forEach((top, index) => {
      vi.spyOn(lists[index]!, "getBoundingClientRect")
        .mockReturnValue(rect(10, top, 300, 22));
      vi.spyOn(listItems[index]!, "getBoundingClientRect")
        .mockReturnValue(rect(40.4, top, 269.6, 22));
      vi.spyOn(paragraphs[index]!, "getBoundingClientRect")
        .mockReturnValue(rect(40.4, top, 269.6, 22));
    });
    const positions = new Map<string, number>();
    doc.descendants((node, position) => {
      if (node.type === noteSchema.nodes.heading || node.type === noteSchema.nodes.list_item) {
        positions.set(node.textContent, position);
      }
      return true;
    });
    vi.spyOn(view, "posAtCoords").mockImplementation(({ top }) => {
      const text = top < 50 ? "标题"
        : top < 90 ? "圆点"
          : top < 130 ? "序号"
            : top < 170 ? "勾选目标"
              : "勾选源";
      const position = positions.get(text)!;
      return { pos: position + 1, inside: position };
    });
    const pointerEvent = (type: string, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: y,
      });
      Object.defineProperty(event, "pointerId", { value: 31 });
      return event;
    };
    host.dispatchEvent(pointerEvent("pointermove", 190));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const indicator = host.querySelector<HTMLElement>(".block-drop-indicator")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    handle.dispatchEvent(pointerEvent("pointerdown", 190));

    const leftEdges = [39, 61, 101, 141].map((y) => {
      window.dispatchEvent(pointerEvent("pointermove", y));
      expect(indicator.classList.contains("visible")).toBe(true);
      return indicator.style.left;
    });

    expect(leftEdges).toEqual(["10px", "10px", "10px", "10px"]);
    window.dispatchEvent(pointerEvent("pointercancel", 141));
  });

  it.each([
    { clientX: 80, expectedLeft: 39.6, level: "B" },
    { clientX: 50, expectedLeft: 9.6, level: "A" },
  ])("reparents the last item to the $level level using the Atlassian hitbox", ({
    clientX,
    expectedLeft,
    level,
  }) => {
    const host = document.createElement("div");
    document.body.append(host);
    const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
      null,
      noteSchema.text(text),
    );
    const item = (text: string, children: readonly ReturnType<typeof noteSchema.nodes.bullet_list.create>[] = []) =>
      noteSchema.nodes.list_item.create({ checked: null }, [paragraph(text), ...children]);
    const c = item("C");
    const b = item("B", [noteSchema.nodes.bullet_list.create(null, c)]);
    const a = item("A", [noteSchema.nodes.bullet_list.create(null, b)]);
    const doc = noteSchema.nodes.doc.create(
      null,
      noteSchema.nodes.bullet_list.create(null, a),
    );
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 220));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 220));
    const listItems = view.dom.querySelectorAll("li");
    const paragraphs = view.dom.querySelectorAll("p");
    vi.spyOn(listItems[0]!, "getBoundingClientRect").mockReturnValue(rect(40, 20, 250, 72));
    vi.spyOn(paragraphs[0]!, "getBoundingClientRect").mockReturnValue(rect(40, 20, 200, 22));
    vi.spyOn(listItems[1]!, "getBoundingClientRect").mockReturnValue(rect(70, 45, 220, 47));
    vi.spyOn(paragraphs[1]!, "getBoundingClientRect").mockReturnValue(rect(70, 45, 200, 22));
    vi.spyOn(listItems[2]!, "getBoundingClientRect").mockReturnValue(rect(100, 70, 190, 22));
    vi.spyOn(paragraphs[2]!, "getBoundingClientRect").mockReturnValue(rect(100, 70, 190, 22));
    let sourcePosition = -1;
    doc.descendants((node, position) => {
      if (node.type === noteSchema.nodes.list_item && node.firstChild?.textContent === "C") {
        sourcePosition = position;
        return false;
      }
      return true;
    });
    vi.spyOn(view, "posAtCoords").mockReturnValue({
      pos: sourcePosition + 1,
      inside: sourcePosition,
    });

    const pointerEvent = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(event, "pointerId", { value: 16 });
      return event;
    };
    host.dispatchEvent(pointerEvent("pointermove", 110, 80));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const indicator = host.querySelector<HTMLElement>(".block-drop-indicator")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });

    handle.dispatchEvent(pointerEvent("pointerdown", 110, 80));
    window.dispatchEvent(pointerEvent("pointermove", clientX, 82));

    expect(indicator.classList.contains("visible")).toBe(true);
    expect(Number.parseFloat(indicator.style.left)).toBeCloseTo(expectedLeft, 5);
    window.dispatchEvent(pointerEvent("pointerup", clientX, 82));

    const rootList = view.state.doc.firstChild!;
    if (level === "B") {
      expect(rootList.childCount).toBe(1);
      const children = rootList.firstChild!.lastChild!;
      expect(Array.from({ length: children.childCount }, (_, index) =>
        children.child(index).firstChild?.textContent)).toEqual(["B", "C"]);
    } else {
      expect(Array.from({ length: rootList.childCount }, (_, index) =>
        rootList.child(index).firstChild?.textContent)).toEqual(["A", "C"]);
    }
  });

  it("leaves dragging state when pointer capture is lost", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("拖动内容")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    const paragraph = view.dom.querySelector("p")!;
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(rect(80, 20, 200, 22));
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const releasePointerCapture = vi.fn(() => {
      throw new DOMException("capture already released", "NotFoundError");
    });
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: releasePointerCapture },
    });
    const startDrag = (pointerId: number) => {
      const event = new MouseEvent("pointerdown", { bubbles: true, button: 0 });
      Object.defineProperty(event, "pointerId", { value: pointerId });
      handle.dispatchEvent(event);
    };
    startDrag(7);
    expect(handle.classList.contains("is-dragging")).toBe(true);

    handle.dispatchEvent(new MouseEvent("lostpointercapture"));

    expect(handle.classList.contains("is-dragging")).toBe(false);
    expect(host.querySelector(".block-row-handle-highlight")?.classList.contains("visible")).toBe(false);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));
    startDrag(8);
    expect(handle.classList.contains("is-dragging")).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(handle.classList.contains("is-dragging")).toBe(false);
  });

  it("uses the top of a heading insert button as a drop boundary", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const heading = (text: string) => noteSchema.nodes.heading.create(
      { level: 1 },
      noteSchema.text(text),
    );
    const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
      null,
      noteSchema.text(text),
    );
    const doc = noteSchema.nodes.doc.create(null, [
      heading("甲"),
      paragraph("甲正文"),
      heading("乙"),
      paragraph("移动"),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin(), rowInsertPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 220));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(40, 0, 260, 220));
    const headings = view.dom.querySelectorAll("h1");
    vi.spyOn(headings[1]!, "getBoundingClientRect").mockReturnValue(rect(40, 90, 260, 22));
    const paragraphs = view.dom.querySelectorAll("p");
    vi.spyOn(paragraphs[1]!, "getBoundingClientRect").mockReturnValue(rect(80, 120, 200, 22));
    let sourcePosition = -1;
    let targetPosition = -1;
    doc.descendants((node, position) => {
      if (node.type === noteSchema.nodes.paragraph && node.textContent === "移动") {
        sourcePosition = position;
      }
      if (node.type === noteSchema.nodes.heading && node.textContent === "乙") {
        targetPosition = position;
      }
      return sourcePosition < 0 || targetPosition < 0;
    });
    vi.spyOn(view, "posAtCoords").mockImplementation(({ top }) => top < 110
      ? { pos: targetPosition + 1, inside: targetPosition }
      : { pos: sourcePosition + 1, inside: sourcePosition });
    const insertButton = view.dom.querySelector<HTMLElement>(".row-insert-button:not(.is-terminal)")!;
    vi.spyOn(insertButton, "getBoundingClientRect").mockReturnValue(rect(40, 65, 260, 20));
    const terminalButton = view.dom.querySelector<HTMLElement>(".row-insert-button.is-terminal")!;
    vi.spyOn(terminalButton, "getBoundingClientRect").mockReturnValue(rect(40, 180, 260, 20));

    const pointerEvent = (type: string, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY: y,
      });
      Object.defineProperty(event, "pointerId", { value: 21 });
      return event;
    };
    host.dispatchEvent(pointerEvent("pointermove", 130));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    handle.dispatchEvent(pointerEvent("pointerdown", 130));
    window.dispatchEvent(pointerEvent("pointermove", 75));

    const indicator = host.querySelector<HTMLElement>(".block-drop-indicator")!;
    expect(indicator.classList.contains("visible")).toBe(true);
    expect(indicator.style.top).toBe("64px");

    window.dispatchEvent(pointerEvent("pointermove", 92));
    expect(indicator.classList.contains("visible")).toBe(true);
    expect(indicator.style.top).toBe("64px");
    window.dispatchEvent(pointerEvent("pointerup", 92));
    expect(Array.from(view.state.doc.content.content, (node) => node.textContent))
      .toEqual(["甲", "甲正文", "移动", "乙"]);
  });

  it("keeps the handle visible under the pointer after a successful drop", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("甲")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("乙")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("丙")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    const paragraphs = Array.from(view.dom.querySelectorAll("p"));
    paragraphs.forEach((paragraph, index) => {
      vi.spyOn(paragraph, "getBoundingClientRect")
        .mockReturnValue(rect(80, 20 + index * 30, 200, 22));
    });
    vi.spyOn(view, "posAtCoords").mockImplementation(({ top }) => {
      if (top < 45) return { pos: 1, inside: 0 };
      if (top < 75) return { pos: 4, inside: 3 };
      return { pos: 7, inside: 6 };
    });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    const pointerEvent = (type: string, clientY: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY,
      });
      Object.defineProperty(event, "pointerId", { value: 11 });
      return event;
    };

    handle.dispatchEvent(pointerEvent("pointerdown", 30));
    window.dispatchEvent(pointerEvent("pointermove", 95));
    window.dispatchEvent(pointerEvent("pointerup", 95));

    expect(view.state.doc.textContent).toBe("乙丙甲");
    expect(handle.classList.contains("visible")).toBe(true);
  });

  it("keeps the viewport at the drop location when moving a row from the end", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("开头")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("中间")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("末尾")),
    ]);
    let editor!: EditorView;
    editor = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
      dispatchTransaction: (transaction) => {
        editor.updateState(editor.state.apply(transaction));
        // WebView can reveal the remapped native selection after the DOM update.
        host.scrollTop = 900;
      },
    });
    view = editor;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    const paragraphs = Array.from(view.dom.querySelectorAll("p"));
    paragraphs.forEach((paragraph) => {
      vi.spyOn(paragraph, "getBoundingClientRect")
        .mockImplementation(() => {
          const current = Array.from(view!.dom.querySelectorAll("p")).indexOf(paragraph);
          return rect(80, 20 + current * 30 - host.scrollTop, 200, 22);
        });
    });
    vi.spyOn(view, "posAtCoords").mockImplementation(({ top }) => {
      if (top < 45) return { pos: 1, inside: 0 };
      if (top < 75) return { pos: 5, inside: 4 };
      return { pos: 9, inside: 8 };
    });
    let restoreFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      restoreFrame = callback;
      return 1;
    });

    const pointerEvent = (type: string, clientY: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY,
      });
      Object.defineProperty(event, "pointerId", { value: 17 });
      return event;
    };
    host.dispatchEvent(pointerEvent("pointermove", 90));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    handle.dispatchEvent(pointerEvent("pointerdown", 90));
    window.dispatchEvent(pointerEvent("pointermove", 21));
    host.scrollTop = 0;
    window.dispatchEvent(pointerEvent("pointerup", 21));

    expect(view.state.doc.textContent).toBe("末尾开头中间");
    expect(host.scrollTop).toBe(900);
    expect(restoreFrame).not.toBeNull();
    (restoreFrame as unknown as FrameRequestCallback)(0);
    expect(host.scrollTop).toBe(0);
  });

  it("keeps a moved empty paragraph hittable", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("甲")),
      noteSchema.nodes.paragraph.create(),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("乙")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(10, 0, 300, 200));
    vi.spyOn(view, "posAtCoords").mockImplementation(({ top }) => {
      if (top < 45) return { pos: 1, inside: 0 };
      if (top < 75) return { pos: 4, inside: 3 };
      return view!.state.doc.child(1).textContent === ""
        ? { pos: 6, inside: 5 }
        : { pos: 7, inside: 6 };
    });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 60,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    const pointerEvent = (type: string, clientY: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX: 100,
        clientY,
      });
      Object.defineProperty(event, "pointerId", { value: 12 });
      return event;
    };

    handle.dispatchEvent(pointerEvent("pointerdown", 60));
    window.dispatchEvent(pointerEvent("pointermove", 95));
    window.dispatchEvent(pointerEvent("pointerup", 95));
    host.dispatchEvent(pointerEvent("pointermove", 95));

    expect(Array.from(view.state.doc.content.content, (node) => node.textContent))
      .toEqual(["甲", "乙", ""]);
    expect(handle.classList.contains("visible")).toBe(true);
  });

  it("deletes only when released over the visible delete target", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("甲")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("乙")),
    ]);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [rowDragPlugin()] }),
    });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(0, 0, 300, 200));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(0, 0, 300, 200));
    const paragraph = view.dom.querySelector("p")!;
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(rect(50, 20, 220, 22));
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });

    host.dispatchEvent(new MouseEvent("pointermove", {
      bubbles: true,
      clientX: 100,
      clientY: 30,
    }));
    const handle = host.querySelector<HTMLElement>(".block-drag-handle")!;
    const deleteTarget = host.querySelector<HTMLElement>(".block-delete-target")!;
    vi.spyOn(deleteTarget, "getBoundingClientRect")
      .mockReturnValue(rect(238, 135, 44, 44));
    Object.defineProperties(handle, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => false) },
    });
    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        button: 0,
        clientX,
        clientY,
      });
      Object.defineProperty(event, "pointerId", { value: 13 });
      return event;
    };

    handle.dispatchEvent(pointerEvent("pointerdown", 100, 30));
    expect(deleteTarget.classList.contains("visible")).toBe(false);

    window.dispatchEvent(pointerEvent("pointermove", 120, 40));
    expect(deleteTarget.classList.contains("visible")).toBe(true);
    expect(deleteTarget.classList.contains("is-armed")).toBe(false);

    window.dispatchEvent(pointerEvent("pointerup", 120, 40));
    expect(view.state.doc.textContent).toBe("甲乙");
    expect(deleteTarget.classList.contains("visible")).toBe(false);

    handle.dispatchEvent(pointerEvent("pointerdown", 100, 30));
    window.dispatchEvent(pointerEvent("pointermove", 160, 40));
    expect(deleteTarget.classList.contains("is-armed")).toBe(false);

    window.dispatchEvent(pointerEvent("pointermove", 250, 150));
    expect(deleteTarget.classList.contains("is-armed")).toBe(true);

    window.dispatchEvent(pointerEvent("pointerup", 120, 40));
    expect(view.state.doc.textContent).toBe("甲乙");
    expect(deleteTarget.classList.contains("visible")).toBe(false);

    handle.dispatchEvent(pointerEvent("pointerdown", 100, 30));
    window.dispatchEvent(pointerEvent("pointermove", 160, 40));
    host.scrollTop = 80;
    window.dispatchEvent(pointerEvent("pointerup", 250, 150));

    expect(view.state.doc.textContent).toBe("乙");
    expect(host.scrollTop).toBe(80);
    expect(deleteTarget.classList.contains("visible")).toBe(false);
  });
});
