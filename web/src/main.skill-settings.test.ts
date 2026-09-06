import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error This test reads the source stylesheet without adding Node types to the browser app.
import { readFileSync } from "node:fs";

import type { DesktopApi } from "./api";
import type { BootstrapData } from "./types";

const { connectApi } = vi.hoisted(() => ({
  connectApi: vi.fn(),
}));

vi.mock("./api", () => ({ connectApi }));

const bootstrap: BootstrapData = {
  config: {
    save_dir: "C:\\Notes",
    language: "zh-CN",
    autostart: false,
    always_on_top: false,
    window_x: null,
    window_y: null,
    window_width: 350,
    window_height: 530,
    note_window_sizes: {},
    last_note: null,
    editor_font: "DengXian",
    editor_font_size: 14,
    heading_divider: true,
    heading_list_highlight: true,
    editor_highlight_color: "#456FC4",
    text_highlight_color: "green",
    last_update_check_ms: null,
    available_version: null,
    pending_update_version: null,
  },
  notes: [],
  system_fonts: [],
  app_version: "1.6.0",
  update_state: { status: "idle", available_version: null },
  update_result: null,
  window_role: "main",
  initial_note: null,
};

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

describe("Skill settings", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    connectApi.mockReset();
    writeText.mockClear();
    document.body.replaceChildren();
  });

  it("shows and copies the GitHub installation prompt", async () => {
    const api = {
      bootstrap: vi.fn().mockResolvedValue(bootstrap),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      rememberLastNote: vi.fn().mockResolvedValue(undefined),
      checkUpdate: vi.fn().mockResolvedValue(bootstrap.update_state),
    } as unknown as DesktopApi;
    connectApi.mockResolvedValue(api);

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector('[data-action="settings"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();

    const skillButton = document.querySelector<HTMLButtonElement>('[data-action="skill-prompt"]')!;
    expect(document.querySelector("#skill-setting-title")?.textContent).toBe("将 Bitty Note 接入你的 AI Agent");
    expect(skillButton.textContent).toBe("获取 Skill");
    skillButton.click();

    expect(document.querySelector(".modal-panel > h2")).toBeNull();
    expect(document.querySelector(".skill-prompt-instructions")?.textContent).toBe(
      "请将提示词发送给你的 AI Agent",
    );
    const prompt = document.querySelector(".skill-prompt-text")?.textContent ?? "";
    expect(prompt).toContain("https://github.com/huangko555/Bitty-Note/tree/main/skills/bitty-note");
    expect(prompt).toContain("保留目录中的全部文件");

    const copyButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".modal-actions button"))
      .find((button) => button.textContent === "复制提示词")!;
    copyButton.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.not.stringContaining("请将下面的安装提示词")));
    await vi.waitFor(() => expect(document.querySelector(".modal-backdrop")).toBeNull());

    expect(document.querySelector(".toast")?.textContent).toBe("已复制安装提示词");
  });

  it("uses the same embedded UI font treatment as the existing settings", () => {
    const styles = readFileSync("web/src/styles.css", "utf8");

    expect(styles).toContain('url("./assets/fonts/SarasaUiSC-Regular.woff2")');
    expect(styles).toContain('url("./assets/fonts/SarasaUiSC-SemiBold.woff2")');
    expect(styles).toMatch(
      /\.skill-setting-card h2\s*\{[^}]*font-family:\s*"Bitty UI", sans-serif;[^}]*font-size:\s*13px;[^}]*font-weight:\s*500;/s,
    );
    expect(styles).toMatch(
      /\.skill-prompt-content\s*\{[^}]*font-family:\s*"Bitty UI", sans-serif;/s,
    );
  });
});
