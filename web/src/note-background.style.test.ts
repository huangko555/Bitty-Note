// @ts-expect-error Node's runtime module is available to Vitest.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("web/src/styles.css", "utf8");

describe("note background interaction colors", () => {
  it("derives interaction states from a matching color for every tinted note", () => {
    for (const background of ["sand", "peach", "rose", "lavender", "sky", "mint", "gray"]) {
      expect(styles).toMatch(new RegExp(
        `\\.app-shell\\[data-note-background="${background}"\\][^{]*{[^}]*--note-state-color:`,
      ));
    }
    expect(styles).toMatch(
      /\.app-shell\[data-note-background\]:not\(\[data-note-background="default"\]\)[^{]*{[^}]*--control-hover-bg:[^}]*--control-pressed-bg:[^}]*--control-selected-bg:[^}]*--control-subtle-hover-bg:[^}]*--control-subtle-pressed-bg:/,
    );
  });

  it("uses the themed states for note controls without recoloring strong or dangerous states", () => {
    expect(styles).toMatch(/\.window-button:hover,[^}]*background:\s*var\(--control-hover-bg\)/);
    expect(styles).toMatch(/\.format-toolbar button:active\s*{[^}]*background:\s*var\(--control-pressed-bg\)/);
    expect(styles).toMatch(/\.format-toolbar button\.is-active\s*{[^}]*background:\s*var\(--control-selected-bg\)/);
    expect(styles).toMatch(/\.row-insert-button:hover,[^}]*background:\s*var\(--control-subtle-hover-bg\)/);
    expect(styles).toMatch(/\.window-button\.is-active\s*{[^}]*background:\s*var\(--ink\)/);
    expect(styles).toMatch(/\.button\.danger\s*{[^}]*background:\s*var\(--danger\)/);
  });

  it("themes text selection and editor popovers", () => {
    expect(styles).toMatch(/--text-highlight-red:\s*#ffc4c4/i);
    expect(styles).toMatch(/--text-highlight-yellow:\s*#ffe176/i);
    expect(styles).toMatch(/--text-highlight-blue:\s*#b9d5ff/i);
    expect(styles).toMatch(/--text-highlight-green:\s*#bfe7b7/i);
    expect(styles).toMatch(
      /\.app-shell\[data-note-background\]:not\(\[data-note-background="default"\]\)[^{]*{[^}]*--editor-selection-bg:[^}]*--editor-popover-bg:/,
    );
    expect(styles).toMatch(
      /\.ProseMirror ::selection\s*{[^}]*background-color:\s*var\(--editor-selection-bg\)/,
    );
    expect(styles).toMatch(
      /\.highlight-color-palette\s*{[^}]*background:\s*var\(--editor-popover-bg\)/,
    );
    expect(styles).toMatch(
      /\.editor-settings-popover\s*{[^}]*background:\s*var\(--editor-popover-bg\)/,
    );
  });

  it("keeps the note title and format bars on the same background as the editor", () => {
    expect(styles).toMatch(
      /\.app-shell\[data-note-background\]:not\(\[data-note-background="default"\]\) \.title-bar,\s*\.app-shell\[data-note-background\]:not\(\[data-note-background="default"\]\) \.format-toolbar\s*{\s*background:\s*var\(--note-background\)/,
    );
  });

  it("gives tinted home and archive cards matching action states", () => {
    for (const background of ["sand", "peach", "rose", "lavender", "sky", "mint", "gray"]) {
      expect(styles).toMatch(new RegExp(
        `\\.note-card\\[data-note-background="${background}"\\]\\s*{[^}]*--note-state-color:`,
      ));
    }
    expect(styles).toMatch(
      /\.note-card\[data-note-background\]:not\(\[data-note-background="default"\]\)\s*{[^}]*--control-hover-bg:[^}]*--control-pressed-bg:/,
    );
    expect(styles).toMatch(/\.note-action:hover\s*{[^}]*background:\s*var\(--control-hover-bg\)/);
    expect(styles).toMatch(/\.archived-action:active\s*{[^}]*background:\s*var\(--control-pressed-bg\)/);
  });

  it("keeps default cards flat and shows chosen colors as a raised lower edge", () => {
    expect(styles).toMatch(
      /\.note-card\s*{[^}]*--note-background:\s*var\(--paper-deep\)[^}]*--note-face-background:\s*var\(--surface\)[^}]*background:\s*var\(--note-face-background\)[^}]*box-shadow:\s*0 1px 2px/,
    );
    expect(styles).toMatch(
      /\.note-card\[data-note-background\]:not\(\[data-note-background="default"\]\)\s*{[^}]*margin-bottom:\s*3px[^}]*box-shadow:\s*0 4px 0 var\(--note-background\),\s*0 5px 0 var\(--note-edge-line\)/,
    );
    expect(styles).not.toMatch(/\.note-card\[data-note-background="default"\]\s*{[^}]*box-shadow:/);
    expect(styles).not.toMatch(/\.note-card:hover,[^{]*{[^}]*transform:/);
  });

  it("lays the background choices out in one row below the menu label", () => {
    expect(styles).toMatch(
      /\.note-window-menu-color-section\s*{[^}]*grid-template-columns:\s*16px 1fr[^}]*row-gap:\s*6px/,
    );
    expect(styles).toMatch(
      /\.note-window-menu-colors\s*{[^}]*grid-column:\s*2[^}]*grid-template-columns:\s*repeat\(8,\s*1fr\)/,
    );
    expect(styles).toMatch(
      /\.note-background-option::after\s*{[^}]*inset:\s*0[^}]*border:\s*2px solid transparent/,
    );
    expect(styles).toMatch(
      /\.note-background-option\.is-active\s+\.lucide-icon\s*{[^}]*opacity:\s*1/,
    );
  });
});
