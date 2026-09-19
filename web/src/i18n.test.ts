import { afterEach, describe, expect, it } from "vitest";

import { setLanguage, t } from "./i18n";

describe("i18n", () => {
  afterEach(() => setLanguage("en"));

  it("uses English by default", () => {
    setLanguage("en");
    expect(t("settingsTitle")).toBe("Settings");
    expect(t("homeTitle")).toBe("Bitty Note");
    expect(t("openNotes")).toBe("Quick open");
    expect(t("newNoteShort")).toBe("New");
    expect(t("renameCurrentNote")).toBe("Rename this note");
    expect(t("openNoteHome")).toBe("Open Bitty Note home");
    expect(document.title).toBe("Bitty Note");
  });

  it("switches to simplified Chinese and interpolates values", () => {
    setLanguage("zh-CN");

    expect(t("settingsTitle")).toBe("设置");
    expect(t("copy")).toBe("创建副本");
    expect(t("createCopy")).toBe("复制");
    expect(t("openNotes")).toBe("快速打开");
    expect(t("newNoteShort")).toBe("新建");
    expect(t("renameCurrentNote")).toBe("重命名此便签");
    expect(t("openNoteHome")).toBe("打开便签主页");
    expect(t("downloadingUpdate")).toBe("正在下载更新，请稍候");
    expect(t("updateAvailable", { version: "1.1.0" })).toBe("发现新版本 v1.1.0");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
