import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  app_version: "1.5.4",
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
    expect(skillButton.textContent).toBe("获取安装提示词");
    skillButton.click();

    const prompt = document.querySelector(".modal-panel > p")?.textContent ?? "";
    expect(prompt).toContain("https://github.com/huangko555/Bitty-Note/tree/main/skills/bitty-note");
    expect(prompt).toContain("保留目录中的全部文件");

    const copyButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".modal-actions button"))
      .find((button) => button.textContent === "复制提示词")!;
    copyButton.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt));
    await vi.waitFor(() => expect(document.querySelector(".modal-backdrop")).toBeNull());

    expect(document.querySelector(".toast")?.textContent).toBe("已复制安装提示词");
  });
});
