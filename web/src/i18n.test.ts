import { afterEach, describe, expect, it } from "vitest";

import { setLanguage, t } from "./i18n";

describe("i18n", () => {
  afterEach(() => setLanguage("en"));

  it("uses English by default", () => {
    setLanguage("en");
    expect(t("settingsTitle")).toBe("Settings");
    expect(t("homeTitle")).toBe("Bitty Note");
    expect(document.title).toBe("Bitty Note");
  });

  it("switches to simplified Chinese and interpolates values", () => {
    setLanguage("zh-CN");

    expect(t("settingsTitle")).toBe("设置");
    expect(t("copy")).toBe("创建副本");
    expect(t("createCopy")).toBe("复制");
    expect(t("updateAvailable", { version: "1.1.0" })).toBe("发现新版本 v1.1.0");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
