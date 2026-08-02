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
});
