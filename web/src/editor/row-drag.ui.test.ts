import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rowDragPlugin } from "./row-drag";
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
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(highlight.classList.contains("visible")).toBe(true);
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    expect(highlight.classList.contains("visible")).toBe(false);
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
  });

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
      paragraph("目标正文"),
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
    vi.spyOn(headings[2]!, "getBoundingClientRect").mockReturnValue(rect(80, 160, 200, 22));
    let targetPosition = -1;
    doc.descendants((node, position) => {
      if (node.type === noteSchema.nodes.paragraph && node.textContent === "目标正文") {
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
    expect(indicator.style.top).toBe("141px");
    window.dispatchEvent(pointerEvent("pointercancel", 130));
  });

  it("places a list drop indicator below the row instead of below its children", () => {
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

    expect(indicator.classList.contains("visible")).toBe(true);
    expect(indicator.style.top).toBe("41px");
    expect(insideIndicator.classList.contains("visible")).toBe(false);
    window.dispatchEvent(pointerEvent("pointercancel", 40));

    host.dispatchEvent(pointerEvent("pointermove", 120));
    handle.dispatchEvent(pointerEvent("pointerdown", 120));
    window.dispatchEvent(pointerEvent("pointermove", 31));

    expect(indicator.classList.contains("visible")).toBe(false);
    expect(insideIndicator.classList.contains("visible")).toBe(true);
    expect(insideIndicator.style.left).toBe("72px");
    expect(insideIndicator.style.top).toBe("17px");
    expect(insideIndicator.style.height).toBe("76px");
    window.dispatchEvent(pointerEvent("pointercancel", 31));
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
