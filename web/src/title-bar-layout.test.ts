// @ts-expect-error This test reads the source stylesheet without adding Node types to the browser app.
import { readFileSync } from "node:fs";
// @ts-expect-error This test reads the source stylesheet without adding Node types to the browser app.
import { resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

declare const process: { cwd: () => string };

describe("note title bar layout", () => {
  const styleElement = document.createElement("style");

  beforeAll(() => {
    styleElement.textContent = readFileSync(
      resolve(process.cwd(), "web/src/styles.css"),
      "utf8",
    );
    document.head.append(styleElement);
  });

  afterAll(() => {
    styleElement.remove();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the pinned state without taking space away from the title", () => {
    document.body.innerHTML = `
      <div class="app-shell quiet-title-bar">
        <header class="title-bar note-title-bar is-pinned">
          <div class="title-left"><button id="window-pin-button" class="window-button is-active"></button></div>
          <div class="window-title"><span class="window-title-text">A very long note title</span></div>
          <div class="window-actions"><button class="window-button"></button></div>
        </header>
      </div>`;

    const title = document.querySelector<HTMLElement>(".window-title")!;
    const style = getComputedStyle(title);
    expect(style.left).toBe("7px");
    expect(style.right).toBe("7px");
    expect(getComputedStyle(document.querySelector("#window-pin-button")!).opacity).toBe("1");
    expect(getComputedStyle(document.querySelector("#window-pin-button")!).backgroundColor)
      .toBe("rgba(0, 0, 0, 0)");
  });

  it("allows the rename input to shrink inside the title safe area", () => {
    const input = document.createElement("input");
    input.className = "title-rename-input";
    document.body.append(input);

    const style = getComputedStyle(input);
    expect(style.flexGrow).toBe("1");
    expect(style.minWidth).toBe("0px");
    expect(style.maxWidth).toBe("190px");
  });

  it("limits elevated action hit areas to the visible controls", () => {
    document.body.innerHTML = `
      <div class="title-left"></div>
      <div class="window-actions"></div>`;

    expect(getComputedStyle(document.querySelector(".title-left")!).width).toBe("max-content");
    expect(getComputedStyle(document.querySelector(".window-actions")!).width).toBe("max-content");
  });
});
