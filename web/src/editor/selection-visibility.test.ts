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
  it("lets the editor finish its click before showing the toolbar", () => {
    const toolbar = document.createElement("div");
    document.body.append(toolbar);
    const deferred: (() => void)[] = [];
    const coordinator = createSelectionVisibilityCoordinator(
      toolbar,
      () => null,
      () => 0,
      (callback) => deferred.push(callback),
    );

    coordinator.editorPressStarted();
    coordinator.focusChanged(true);

    expect(toolbar.classList.contains("visible")).toBe(false);

    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(toolbar.classList.contains("visible")).toBe(false);
    expect(deferred).toHaveLength(0);

    const click = new MouseEvent("click", { cancelable: true });
    window.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(toolbar.classList.contains("visible")).toBe(false);
    expect(deferred).toHaveLength(1);

    deferred.shift()?.();
    expect(toolbar.classList.contains("visible")).toBe(true);
  });

  it("does not change toolbar state for editor controls", () => {
    const toolbar = document.createElement("div");
    const host = document.createElement("div");
    const control = document.createElement("button");
    control.dataset.editorControl = "true";
    host.append(control);
    document.body.append(host, toolbar);
    const coordinator = createSelectionVisibilityCoordinator(toolbar, () => null);
    host.addEventListener("mousedown", coordinator.editorPressStarted, true);

    control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(toolbar.classList.contains("visible")).toBe(false);
  });

  it("does not show the toolbar for host padding outside the editor", () => {
    const toolbar = document.createElement("div");
    const host = document.createElement("div");
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    host.append(editor);
    document.body.append(host, toolbar);
    const deferred: (() => void)[] = [];
    const coordinator = createSelectionVisibilityCoordinator(
      toolbar,
      () => null,
      () => 0,
      (callback) => deferred.push(callback),
    );
    host.addEventListener("mousedown", coordinator.editorPressStarted, true);

    host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    window.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    deferred.shift()?.();

    expect(toolbar.classList.contains("visible")).toBe(false);
  });

  it("does not expose the toolbar when the window only restores editor focus", () => {
    const toolbar = document.createElement("div");
    document.body.append(toolbar);
    const coordinator = createSelectionVisibilityCoordinator(toolbar, () => null);

    coordinator.focusChanged(true);

    expect(toolbar.classList.contains("visible")).toBe(false);
  });

  it("undoes restored editor focus when the activating press is a control", () => {
    const toolbar = document.createElement("div");
    const host = document.createElement("div");
    const editor = document.createElement("div");
    const control = document.createElement("button");
    editor.className = "ProseMirror";
    editor.tabIndex = 0;
    control.dataset.editorControl = "true";
    host.append(editor, control);
    document.body.append(host, toolbar);
    const coordinator = createSelectionVisibilityCoordinator(toolbar, () => null);
    host.addEventListener("pointerdown", coordinator.editorPressStarted, true);
    editor.focus();
    coordinator.focusChanged(true);

    control.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(document.activeElement).not.toBe(editor);
    expect(toolbar.classList.contains("visible")).toBe(false);
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

    coordinator.show();
    frames.shift()?.(0);
    coordinator.selectionChanged();
    frames.shift()?.(16);

    expect(ensureSelectionVisible).toHaveBeenCalledTimes(2);
    expect(toolbar.classList.contains("visible")).toBe(true);
  });

  it("scrolls a caret above an overlaid toolbar", () => {
    const host = document.createElement("div");
    host.scrollTop = 120;
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(42, 546));

    keepRectVisible(host, rect(486, 516), 44);

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
