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
  background: "sky",
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
  app_version: "1.4.0",
  update_state: { status: "idle", available_version: null },
  update_result: null,
  window_role: "note",
  initial_note: note.name,
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
    const showMainWindow = vi.fn().mockResolvedValue(undefined);
    const saveNote = vi.fn().mockResolvedValue({
      status: "saved",
      revision: "revision-2",
      external_content: null,
      has_bom: false,
      newline: "\n",
    });
    const api = {
      bootstrap: vi.fn().mockResolvedValue(bootstrap),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      acquireNote: vi.fn().mockResolvedValue(true),
      openNote: vi.fn().mockResolvedValue(note),
      showMainWindow,
      rememberLastNote: vi.fn().mockResolvedValue(undefined),
      saveNote,
      setTextHighlightColor: vi.fn(async (color) => color),
      checkUpdate: vi.fn().mockResolvedValue(bootstrap.update_state),
      windowReady: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    connectApi.mockResolvedValue(api);

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    await vi.waitFor(() => expect(api.windowReady).toHaveBeenCalledOnce());
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement?.classList.contains("ProseMirror")).toBe(false);

    const pin = document.querySelector<HTMLButtonElement>('[data-action="pin"]')!;
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

    const shell = document.querySelector<HTMLElement>(".app-shell")!;
    expect(shell.dataset.noteBackground).toBe("sky");
    expect(document.querySelector('[data-action="note-background"]')).toBeNull();
    expect(document.querySelector(".note-background-picker")).toBeNull();

    const title = document.querySelector<HTMLElement>(".window-title")!;
    title.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    title.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    const renameInput = document.querySelector<HTMLInputElement>(".title-rename-input")!;
    expect(renameInput).not.toBeNull();
    expect(document.querySelector(".note-background-picker")).toBeNull();

    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".title-rename-input")).toBeNull();

    const appearanceButton = toolbar.querySelector<HTMLButtonElement>(
      ".editor-settings-button",
    )!;
    appearanceButton.click();
    const appearancePopover = document.querySelector<HTMLElement>(
      ".editor-settings-popover",
    )!;
    expect(appearancePopover.classList.contains("visible")).toBe(true);
    expect(appearancePopover.querySelector('[data-editor-setting="note-background"]')).toBeNull();
    appearanceButton.click();

    expect(document.querySelector(".title-pin-indicator")).toBeNull();
    const noteMenuButton = document.querySelector<HTMLButtonElement>('[data-action="note-menu"]')!;
    noteMenuButton.click();
    const noteMenu = document.querySelector<HTMLElement>(".note-window-menu")!;
    expect(noteMenu).not.toBeNull();
    expect(noteMenu.querySelector(".note-window-menu-color-label")?.textContent)
      .toBe("背景颜色");
    expect(noteMenu.querySelectorAll(".note-window-menu-colors .note-background-option"))
      .toHaveLength(8);
    expect(noteMenu.querySelector('[data-action="rename"]')).not.toBeNull();
    expect(noteMenu.querySelector('[data-action="show-note-list"]')).not.toBeNull();
    expect(noteMenu.querySelector('[data-action="close-note"]')).not.toBeNull();
    noteMenu.querySelector<HTMLButtonElement>('[data-background="mint"]')!.click();
    expect(shell.dataset.noteBackground).toBe("mint");
    await vi.waitFor(() => expect(saveNote).toHaveBeenCalled());
    expect(saveNote.mock.calls.at(-1)?.[0].background).toBe("mint");
    expect(document.querySelector(".note-window-menu")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".note-window-menu")).toBeNull();

    noteMenuButton.click();
    document.querySelector<HTMLButtonElement>('[data-action="show-note-list"]')!.click();
    await vi.waitFor(() => expect(showMainWindow).toHaveBeenCalledOnce());

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

    pin.focus();
    window.dispatchEvent(new Event("focus"));

    expect.soft(document.activeElement).not.toBe(pin);
  });

  it("keeps the main window on the note list instead of reopening the last note", async () => {
    const openNote = vi.fn();
    const api = {
      bootstrap: vi.fn().mockResolvedValue({
        ...bootstrap,
        config: { ...bootstrap.config, last_note: note.name },
        notes: [{ name: note.name, preview: "", modified_ms: 1 }],
        window_role: "main",
        initial_note: null,
      }),
      listNotes: vi.fn().mockResolvedValue([
        { name: note.name, preview: "", modified_ms: 1 },
      ]),
      rememberLastNote: vi.fn().mockResolvedValue(undefined),
      openNote,
      checkUpdate: vi.fn().mockResolvedValue(bootstrap.update_state),
      windowReady: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    connectApi.mockResolvedValue(api);

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector(".home-page")).not.toBeNull());

    expect(openNote).not.toHaveBeenCalled();
    expect(document.querySelector('[data-action="close"]')).not.toBeNull();
    expect(document.querySelector('[data-action="minimize"]')).toBeNull();
    expect(document.querySelector('[data-action="pin"]')).toBeNull();
  });

  it("closes an auxiliary window that starts without a note instead of leaving a blank surface", async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const api = {
      bootstrap: vi.fn().mockResolvedValue({
        ...bootstrap,
        window_role: "note",
        initial_note: null,
      }),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      closeWindow,
    } as unknown as DesktopApi;
    connectApi.mockResolvedValue(api);

    await import("./main");

    await vi.waitFor(() => expect(closeWindow).toHaveBeenCalledOnce());
    expect(document.querySelector(".fatal-error")?.textContent).toContain("启动");
  });
});
