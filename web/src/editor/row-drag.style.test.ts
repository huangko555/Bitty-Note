// @ts-expect-error Node's runtime module is available to Vitest.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("web/src/styles.css", "utf8");

describe("row drag preview visual contract", () => {
  it("is translucent while dragging and opaque when deletion is armed", () => {
    expect(styles).toMatch(/\.block-drag-preview\s*{[^}]*opacity:\s*\.72/);
    expect(styles).toMatch(
      /\.block-drag-preview\.is-delete-armed\s*{[^}]*opacity:\s*1/,
    );
  });

  it("uses a restrained shadow", () => {
    expect(styles).toMatch(
      /\.block-drag-preview::before\s*{[^}]*box-shadow:[^}]*\/ 12%\)[^}]*\/ 10%\)/,
    );
  });
});
