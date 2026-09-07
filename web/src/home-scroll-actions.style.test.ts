// @ts-expect-error Node's runtime module is available to Vitest.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("web/src/styles.css", "utf8");

describe("home scroll actions visual contract", () => {
  it("keeps the back-to-top button the same size as create and gives it a white surface", () => {
    expect(styles).toMatch(/\.create-button\s*{[^}]*width:\s*46px[^}]*height:\s*46px/);
    expect(styles).toMatch(
      /\.back-to-top-button\s*{[^}]*width:\s*46px[^}]*height:\s*46px[^}]*background:\s*#fff/,
    );
    expect(styles).toMatch(
      /\.back-to-top-button \.lucide-icon\s*{[^}]*width:\s*25px[^}]*height:\s*25px[^}]*stroke-width:\s*1\.4/,
    );
    expect(styles).toMatch(/\.back-to-top-button\[hidden\]\s*{[^}]*display:\s*none/);
  });
});
