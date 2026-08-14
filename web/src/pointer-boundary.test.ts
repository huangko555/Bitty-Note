import { describe, expect, it, vi } from "vitest";

import {
  isPointerInsideElement,
  shouldBeginTitleBarDrag,
} from "./pointer-boundary";

describe("pointer boundary", () => {
  it("treats coordinates inside an input as internal when the webview reports its parent", () => {
    const title = document.createElement("div");
    const input = document.createElement("input");
    title.append(input);
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      left: 20,
      right: 220,
      top: 8,
      bottom: 34,
      width: 200,
      height: 26,
      x: 20,
      y: 8,
      toJSON: () => ({}),
    });

    expect(isPointerInsideElement(input, {
      clientX: 205,
      clientY: 20,
      target: title,
    })).toBe(true);
  });

  it("still treats coordinates beyond the input bounds as external", () => {
    const input = document.createElement("input");
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      left: 20,
      right: 220,
      top: 8,
      bottom: 34,
      width: 200,
      height: 26,
      x: 20,
      y: 8,
      toJSON: () => ({}),
    });

    expect(isPointerInsideElement(input, {
      clientX: 221,
      clientY: 20,
      target: document.body,
    })).toBe(false);
  });

  it("does not start title-bar dragging inside a rename input when the webview reports its parent", () => {
    const title = document.createElement("div");
    const input = document.createElement("input");
    title.append(input);
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      left: 20,
      right: 220,
      top: 8,
      bottom: 34,
      width: 200,
      height: 26,
      x: 20,
      y: 8,
      toJSON: () => ({}),
    });

    expect(shouldBeginTitleBarDrag({
      button: 0,
      clientX: 205,
      clientY: 20,
      target: title,
    }, input)).toBe(false);
  });

});
