import { describe, expect, it } from "vitest";

import { prepareForWindowMinimize, syncPinButtons } from "./window-controls";

describe("window controls", () => {
  it("keeps stale hover suppressed until the pointer moves after focus returns", () => {
    const root = document.createElement("div");
    const button = document.createElement("button");
    const pointerSource = new EventTarget();
    document.body.append(button);
    button.focus();

    prepareForWindowMinimize(button, root, pointerSource);

    expect(document.activeElement).not.toBe(button);
    expect(root.classList.contains("window-hover-suppressed")).toBe(true);
    pointerSource.dispatchEvent(new Event("pointermove"));
    expect(root.classList.contains("window-hover-suppressed")).toBe(true);
    pointerSource.dispatchEvent(new Event("focus"));
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
    document.body.append(root);
    const focusedButton = root.querySelector<HTMLButtonElement>('[data-action="pin"]')!;
    focusedButton.focus();

    syncPinButtons(root, true);

    expect(document.activeElement).not.toBe(focusedButton);
    root.querySelectorAll<HTMLButtonElement>('[data-action="pin"]').forEach((button) => {
      expect(button.classList.contains("is-active")).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("true");
    });
    root.remove();
  });

  it("synchronizes the title pin indicator", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span class="title-pin-indicator" hidden></span>';
    const indicator = root.querySelector<HTMLElement>(".title-pin-indicator")!;

    syncPinButtons(root, true);
    expect(indicator.hidden).toBe(false);

    syncPinButtons(root, false);
    expect(indicator.hidden).toBe(true);
  });
});
