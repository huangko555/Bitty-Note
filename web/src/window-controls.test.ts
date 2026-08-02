import { describe, expect, it } from "vitest";

import { syncPinButtons } from "./window-controls";

describe("window controls", () => {
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
