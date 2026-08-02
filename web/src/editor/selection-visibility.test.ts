import { describe, expect, it, vi } from "vitest";

import {
  createSelectionVisibilityCoordinator,
  keepRectVisible,
} from "./selection-visibility";

function rect(top: number, bottom: number): DOMRect {
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

describe("selection visibility", () => {
  it("keeps a toolbar shown during an editor press from receiving that press", () => {
    const toolbar = document.createElement("div");
    document.body.append(toolbar);
    const coordinator = createSelectionVisibilityCoordinator(toolbar, () => null);

    coordinator.editorPressStarted();
    coordinator.focusChanged(true);

    expect(toolbar.classList.contains("visible")).toBe(true);
    expect(toolbar.classList.contains("ignore-current-press")).toBe(true);

    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(toolbar.classList.contains("ignore-current-press")).toBe(false);
  });

  it("checks the final selection again when it changes after the focus frame", () => {
    const toolbar = document.createElement("div");
    document.body.append(toolbar);
    const ensureSelectionVisible = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const coordinator = createSelectionVisibilityCoordinator(
      toolbar,
      () => ({ ensureSelectionVisible }),
      (callback) => frames.push(callback),
    );

    coordinator.focusChanged(true);
    frames.shift()?.(0);
    coordinator.selectionChanged();
    frames.shift()?.(16);

    expect(ensureSelectionVisible).toHaveBeenCalledTimes(2);
    expect(toolbar.classList.contains("visible")).toBe(true);
  });

  it("scrolls a caret above the toolbar after the editor viewport shrinks", () => {
    const host = document.createElement("div");
    host.scrollTop = 120;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(42, 502));

    keepRectVisible(host, rect(486, 516));

    expect(host.scrollTop).toBe(142);
  });

  it("does not move an already visible caret", () => {
    const host = document.createElement("div");
    host.scrollTop = 120;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(42, 502));

    keepRectVisible(host, rect(470, 486));

    expect(host.scrollTop).toBe(120);
  });
});
