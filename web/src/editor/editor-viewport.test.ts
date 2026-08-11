import { describe, expect, it, vi } from "vitest";

import {
  autoScrollForPointer,
  preserveVisualAnchorDuring,
  preserveViewportDuring,
  revealDocumentRect,
  scrollForWheel,
} from "./editor-viewport";

function viewport(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 300,
    width: 300,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

describe("editor viewport", () => {
  it("reveals a dropped single-line block above a bottom overlay", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.scrollTop = 100;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(viewport(0, 200));
    let frame: FrameRequestCallback | null = null;

    revealDocumentRect(host, () => ({ top: 160, bottom: 182 }), 44, (callback) => {
      frame = callback;
      return 1;
    });
    (frame as unknown as FrameRequestCallback)(0);

    expect(host.scrollTop).toBe(134);
    host.remove();
  });

  it("uses the full height of a multiline or parent block", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.scrollTop = 100;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(viewport(0, 200));
    let frame: FrameRequestCallback | null = null;

    revealDocumentRect(host, () => ({ top: 90, bottom: 190 }), 44, (callback) => {
      frame = callback;
      return 1;
    });
    (frame as unknown as FrameRequestCallback)(0);

    expect(host.scrollTop).toBe(142);
    host.remove();
  });

  it("anchors an oversized dropped block by its top", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.scrollTop = 100;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(viewport(0, 200));
    let frame: FrameRequestCallback | null = null;

    revealDocumentRect(host, () => ({ top: 40, bottom: 240 }), 44, (callback) => {
      frame = callback;
      return 1;
    });
    (frame as unknown as FrameRequestCallback)(0);

    expect(host.scrollTop).toBe(132);
    host.remove();
  });

  it("owns pointer auto-scroll and fixed viewport preservation", () => {
    const host = document.createElement("div");
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(viewport(0, 200));
    host.scrollTop = 100;

    autoScrollForPointer(host, 5);
    expect(host.scrollTop).toBe(82);
    autoScrollForPointer(host, 195);
    expect(host.scrollTop).toBe(100);
    preserveViewportDuring(host, () => {
      host.scrollTop = 500;
    });
    expect(host.scrollTop).toBe(100);
  });

  it("keeps a semantic visual anchor stable after layout changes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.scrollTop = 240;
    const locateAnchorTop = () => 100 - host.scrollTop;
    let frame: FrameRequestCallback | null = null;

    preserveVisualAnchorDuring(host, locateAnchorTop, () => {
      host.scrollTop = 220;
    }, (callback) => {
      frame = callback;
      return 1;
    });
    (frame as unknown as FrameRequestCallback)(0);

    expect(host.scrollTop).toBe(240);
    host.remove();
  });

  it("normalizes line and page wheel deltas", () => {
    const host = document.createElement("div");
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(viewport(0, 200));
    const scrollBy = vi.fn();
    Object.defineProperty(host, "scrollBy", { value: scrollBy });

    scrollForWheel(host, 2, WheelEvent.DOM_DELTA_LINE);
    scrollForWheel(host, 1, WheelEvent.DOM_DELTA_PAGE);

    expect(scrollBy).toHaveBeenNthCalledWith(1, { top: 32, behavior: "smooth" });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { top: 200, behavior: "smooth" });
  });
});
