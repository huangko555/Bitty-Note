import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "./api";
import type { BootstrapData, OpenedNote } from "./types";

const { connectApi } = vi.hoisted(() => ({
  connectApi: vi.fn(),
}));

vi.mock("./api", () => ({ connectApi }));

const note: OpenedNote = {
  name: "Startup.md",
  content: "启动内容",
  revision: "revision-1",
  has_bom: false,
  newline: "\n",
};

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
    last_note: note.name,
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
  app_version: "1.4.0",
  update_state: { status: "idle", available_version: null },
  update_result: null,
  window_role: "main",
  initial_note: null,
};

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

describe("startup chrome visibility", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(window, "setInterval").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    connectApi.mockReset();
    document.body.replaceChildren();
    document.documentElement.className = "";
  });

  it("keeps startup chrome hidden without focusing the restored editor", async () => {
    const api = {
      bootstrap: vi.fn().mockResolvedValue(bootstrap),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      acquireNote: vi.fn().mockResolvedValue(true),
      openNote: vi.fn().mockResolvedValue(note),
      rememberLastNote: vi.fn().mockResolvedValue(undefined),
      setTextHighlightColor: vi.fn(async (color) => color),
      checkUpdate: vi.fn().mockResolvedValue(bootstrap.update_state),
    } as unknown as DesktopApi;
    connectApi.mockResolvedValue(api);

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement?.classList.contains("ProseMirror")).toBe(false);

    const back = document.querySelector<HTMLButtonElement>('[data-action="back"]')!;
    const toolbar = document.querySelector<HTMLElement>(".format-toolbar")!;
    const highlight = toolbar.querySelector<HTMLButtonElement>('[data-action="highlight"]');
    expect(highlight).not.toBeNull();
    expect(highlight?.closest(".highlight-control")?.previousElementSibling?.getAttribute("data-action"))
      .toBe("strike");
    expect(highlight?.closest(".highlight-control")?.nextElementSibling?.classList.contains("format-toolbar-separator"))
      .toBe(true);
    expect(toolbar.querySelectorAll<HTMLButtonElement>(".highlight-color-swatch"))
      .toHaveLength(4);
    expect(toolbar.querySelector<HTMLButtonElement>(".highlight-menu-button")?.getAttribute("aria-expanded"))
      .toBe("false");
    expect(toolbar.querySelector(".highlight-menu-button path")?.getAttribute("d"))
      .toBe("m18 15-6-6-6 6");
    expect.soft(toolbar.classList.contains("visible")).toBe(false);

    const colorMenu = toolbar.querySelector<HTMLButtonElement>(".highlight-menu-button")!;
    const colorPalette = toolbar.querySelector<HTMLElement>(".highlight-color-palette")!;
    colorMenu.click();
    expect(colorPalette.classList.contains("visible")).toBe(true);
    toolbar.querySelector<HTMLButtonElement>('[data-highlight-color="red"].highlight-color-swatch')!
      .click();
    await vi.waitFor(() => {
      expect(api.setTextHighlightColor).toHaveBeenCalledWith("red");
    });
    expect(colorPalette.classList.contains("visible")).toBe(false);
    expect(highlight?.dataset.highlightColor).toBe("red");

    back.focus();
    window.dispatchEvent(new Event("focus"));

    expect.soft(document.activeElement).not.toBe(back);
  });
});
