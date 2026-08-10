import { describe, expect, it, vi } from "vitest";

import {
  alignDocumentBoundary,
  autoScrollForPointer,
  preserveViewportDuring,
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
  it("keeps a semantic document boundary at its preferred screen position", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.scrollTop = 900;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(viewport(0, 200));
    let frame: FrameRequestCallback | null = null;

    alignDocumentBoundary(host, () => -880, 20, (callback) => {
      frame = callback;
      return 1;
    });
    (frame as unknown as FrameRequestCallback)(0);

    expect(host.scrollTop).toBe(0);
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

  it("normalizes line and page wheel deltas", () => {
    const host = document.createElement("div");
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(viewport(0, 200));
    host.scrollTop = 10;

    scrollForWheel(host, 2, WheelEvent.DOM_DELTA_LINE);
    expect(host.scrollTop).toBe(42);
    scrollForWheel(host, 1, WheelEvent.DOM_DELTA_PAGE);
    expect(host.scrollTop).toBe(242);
  });
});
