import { describe, expect, it } from "vitest";
// This source-level contract intentionally reads the stylesheet itself. The app's
// browser tsconfig doesn't include Node typings, while Vitest still runs in Node.
// @ts-expect-error Node's runtime module is available to Vitest.
import { readFileSync } from "node:fs";

const styles = readFileSync("web/src/styles.css", "utf8");

describe("highlight toolbar visual contract", () => {
  it("keeps the arrow area unseparated and the palette compact", () => {
    expect(styles).not.toContain("border-left: 1px solid var(--line)");
    expect(styles).toMatch(/\.highlight-menu-button[^}]+margin-left:\s*-3px/);
    expect(styles).toMatch(/\.highlight-menu-button:hover \.lucide-icon[^}]+stroke-width:\s*2\.3/);
    expect(styles).toMatch(/\.highlight-color-palette[^}]+gap:\s*9px/);
    expect(styles).toMatch(/\.highlight-color-palette[^}]+padding:\s*8px/);
    expect(styles).toMatch(/\.highlight-color-swatch[^}]+width:\s*18px/);
    expect(styles).toMatch(/\.highlight-color-swatch[^}]+height:\s*18px/);
  });

  it("preserves the swatch fill color on hover and only accents its border", () => {
    expect(styles).toMatch(
      /\.format-toolbar \.highlight-color-swatch:hover\s*{[^}]*background:\s*var\(--swatch\)[^}]*outline-color:/,
    );
  });

  it("preserves each selected swatch's own fill color", () => {
    expect(styles).toMatch(
      /\.format-toolbar \.highlight-color-swatch\.is-active\s*{[^}]*background:\s*var\(--swatch\)/,
    );
  });

  it("shows every highlight on a checked task row in the same light gray", () => {
    expect(styles).toMatch(/--text-highlight-checked:\s*#[0-9a-f]{6}/i);
    expect(styles).toMatch(
      /\.task-list-item\.is-checked\s*>\s*\.task-content\s*>\s*p:first-child\s+mark\.text-highlight\s*{[^}]*background:\s*var\(--text-highlight-checked\)/,
    );
  });
});
