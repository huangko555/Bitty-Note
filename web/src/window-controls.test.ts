import { describe, expect, it } from "vitest";

import { prepareForWindowMinimize, syncPinButtons } from "./window-controls";

describe("window controls", () => {
  it("clears focus and suppresses stale hover until the pointer moves", () => {
    const root = document.createElement("div");
    const button = document.createElement("button");
    const pointerSource = new EventTarget();
    document.body.append(button);
    button.focus();

    prepareForWindowMinimize(button, root, pointerSource);

    expect(document.activeElement).not.toBe(button);
    expect(root.classList.contains("window-hover-suppressed")).toBe(true);
    pointerSource.dispatchEvent(new Event("pointermove"));
    expect(root.classList.contains("window-hover-suppressed")).toBe(false);
    button.remove();
  });

  it("synchronizes every current pin button after an asynchronous page change", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-action="pin"></button>
      <section><button data-action="pin"></button></section>
    `;

    syncPinButtons(root, true);

    root.querySelectorAll<HTMLButtonElement>('[data-action="pin"]').forEach((button) => {
      expect(button.classList.contains("is-active")).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("true");
    });
  });
});
