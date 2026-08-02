import { afterEach, describe, expect, it } from "vitest";

import { setLanguage, t } from "./i18n";

describe("i18n", () => {
  afterEach(() => setLanguage("en"));

  it("uses English by default", () => {
    expect(t("settingsTitle")).toBe("Settings");
  });

  it("switches to simplified Chinese and interpolates values", () => {
    setLanguage("zh-CN");

    expect(t("settingsTitle")).toBe("设置");
    expect(t("updateAvailable", { version: "1.1.0" })).toBe("发现新版本 v1.1.0。");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
