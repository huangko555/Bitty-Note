import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "./api";
import type { BootstrapData } from "./types";

const { connectApi } = vi.hoisted(() => ({
  connectApi: vi.fn(),
}));

vi.mock("./api", () => ({ connectApi }));

const note = { name: "示例.md", preview: "正文", modified_ms: 1 };
const otherNote = { name: "其他.md", preview: "正文", modified_ms: 0 };
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
  notes: [note],
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

describe("home note card actions", () => {
  const openNoteWindow = vi.fn().mockResolvedValue("opened");
  const openNoteInEditor = vi.fn().mockResolvedValue(undefined);
  const archiveNote = vi.fn().mockResolvedValue(undefined);
  const moveNoteToTrash = vi.fn().mockResolvedValue(undefined);
  const setNotePinned = vi.fn().mockResolvedValue([note.name]);
  const restoreArchivedNote = vi.fn().mockResolvedValue(undefined);
  const deleteArchivedNote = vi.fn().mockResolvedValue(undefined);
  const listNotes = vi.fn().mockResolvedValue([]);
  const listArchivedNotes = vi.fn().mockResolvedValue([note]);

  beforeEach(async () => {
    vi.resetModules();
    listNotes.mockReset().mockResolvedValueOnce([note]).mockResolvedValue([]);
    listArchivedNotes.mockReset().mockResolvedValue([note]);
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(window, "setInterval").mockReturnValue(0);
    const api = {
      bootstrap: vi.fn().mockResolvedValue(bootstrap),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      rememberLastNote: vi.fn().mockResolvedValue(undefined),
      checkUpdate: vi.fn().mockResolvedValue(bootstrap.update_state),
      listNotes,
      listArchivedNotes,
      requestNoteRename: vi.fn().mockResolvedValue("available"),
      openNoteWindow,
      openNoteInEditor,
      archiveNote,
      moveNoteToTrash,
      setNotePinned,
      restoreArchivedNote,
      deleteArchivedNote,
    } as unknown as DesktopApi;
    connectApi.mockResolvedValue(api);

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector(".note-card")).not.toBeNull());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    connectApi.mockReset();
    openNoteWindow.mockClear();
    openNoteInEditor.mockClear();
    archiveNote.mockClear();
    moveNoteToTrash.mockClear();
    setNotePinned.mockClear();
    restoreArchivedNote.mockClear();
    deleteArchivedNote.mockClear();
    listNotes.mockClear();
    listArchivedNotes.mockClear();
    document.body.replaceChildren();
  });

  it("shows note actions, opens the file in its default editor, and confirms before moving it to the Recycle Bin", async () => {
    document.querySelector(".note-card")!.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 60,
    }));

    const menu = document.querySelector<HTMLElement>(".note-context-menu")!;
    expect(menu.getAttribute("aria-label")).toBe("记录操作：示例.md");
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "置顶",
      "在新窗口打开",
      "用编辑器打开",
      "复制",
      "重命名",
      "归档",
      "移至回收站",
    ]);
    expect(buttons.every((button) => button.querySelector(".lucide-icon"))).toBe(true);
    expect(menu.querySelector('[data-action="pin"] .lucide-icon')?.innerHTML).toContain('d="M5 3h14"');
    menu.querySelector<HTMLButtonElement>('[data-action="open-editor"]')!.click();
    await vi.waitFor(() => expect(openNoteInEditor).toHaveBeenCalledWith(note.name));

    document.querySelector(".note-card")!.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 60,
    }));
    const reopenedMenu = document.querySelector<HTMLElement>(".note-context-menu")!;
    expect(reopenedMenu.querySelector('[role="separator"]')?.nextElementSibling).toBe(
      reopenedMenu.querySelector('[data-action="archive"]'),
    );

    const trashButton = reopenedMenu.querySelector<HTMLButtonElement>('[data-action="trash"]')!;
    expect(trashButton.classList.contains("danger")).toBe(true);
    trashButton.click();

    expect(moveNoteToTrash).not.toHaveBeenCalled();
    expect(trashButton.classList.contains("confirm")).toBe(true);
    expect(trashButton.textContent?.trim()).toBe("确认移至回收站");

    trashButton.click();
    await vi.waitFor(() => expect(moveNoteToTrash).toHaveBeenCalledWith(note.name));
  });

  it("renders pinned and recently edited groups with the same card style", async () => {
    listNotes.mockResolvedValue([note, otherNote]);
    document.querySelector(".note-card")!.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }));

    document.querySelector<HTMLButtonElement>('.note-context-menu [data-action="pin"]')!.click();

    await vi.waitFor(() => expect(setNotePinned).toHaveBeenCalledWith(note.name, true));
    await vi.waitFor(() => expect(document.querySelectorAll(".note-section-title")).toHaveLength(2));
    expect(Array.from(document.querySelectorAll(".note-section-title"), (heading) => heading.textContent)).toEqual([
      "置顶",
      "最近编辑",
    ]);
    expect(document.querySelector(".note-card.is-pinned")).toBeNull();
    expect(document.querySelector(".note-pin-indicator")).toBeNull();
  });

  it("opens the copy dialog from the home context menu", () => {
    document.querySelector(".note-card")!.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }));

    document.querySelector<HTMLButtonElement>('[data-action="copy"]')!.click();

    expect(document.querySelector(".modal-panel")?.textContent).toContain("创建副本");
  });

  it("shows restore and confirmed Recycle Bin actions on archived cards", async () => {
    document.querySelector<HTMLButtonElement>('[data-action="show-archive"]')!.click();
    await vi.waitFor(() => expect(document.querySelector(".archived-note-card")).not.toBeNull());

    document.querySelector(".archived-note-card")!.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }));
    let menu = document.querySelector<HTMLElement>(".note-context-menu")!;
    expect(menu.getAttribute("aria-label")).toBe("归档记录操作：示例.md");
    let buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["还原", "移至回收站"]);
    expect(buttons.every((button) => button.querySelector(".lucide-icon"))).toBe(true);

    menu.querySelector<HTMLButtonElement>('[data-action="restore"]')!.click();
    await vi.waitFor(() => expect(restoreArchivedNote).toHaveBeenCalledWith(note.name));

    document.querySelector(".archived-note-card")!.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }));
    menu = document.querySelector<HTMLElement>(".note-context-menu")!;
    const trashButton = menu.querySelector<HTMLButtonElement>('[data-action="trash"]')!;
    trashButton.click();
    expect(deleteArchivedNote).not.toHaveBeenCalled();
    expect(trashButton.textContent?.trim()).toBe("确认移至回收站");
    trashButton.click();
    await vi.waitFor(() => expect(deleteArchivedNote).toHaveBeenCalledWith(note.name));
  });

  it("uses note pin flags from refreshed summaries when the local config is stale", async () => {
    bootstrap.config.pinned_notes = ["旧名称.md"];
    listNotes.mockResolvedValue([
      { ...note, name: "新名称.md", pinned: true },
      { ...otherNote, pinned: false },
    ]);

    window.desktopNotesRefreshHome?.();

    await vi.waitFor(() => expect(document.querySelectorAll(".note-section-title")).toHaveLength(2));
    expect(Array.from(document.querySelectorAll(".note-section-title"), (heading) => heading.textContent)).toEqual([
      "置顶",
      "最近编辑",
    ]);
    expect(document.querySelector(".note-card strong")?.textContent).toBe("新名称");
  });

  it("opens the note in a new window on middle click", async () => {
    document.querySelector(".note-card")!.dispatchEvent(new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    }));

    await vi.waitFor(() => expect(openNoteWindow).toHaveBeenCalledWith(note.name));
  });

  it("reveals a white back-to-top button once the home title has scrolled away", () => {
    const home = document.querySelector<HTMLElement>(".home-page")!;
    const title = home.querySelector<HTMLElement>(".home-title")!;
    Object.defineProperty(title, "offsetTop", { configurable: true, value: 24 });
    Object.defineProperty(title, "offsetHeight", { configurable: true, value: 32 });
    const scrollTo = vi.fn();
    Object.defineProperty(home, "scrollTo", { configurable: true, value: scrollTo });
    const backToTop = home.querySelector<HTMLButtonElement>('[data-action="back-to-top"]')!;

    expect(backToTop).not.toBeNull();
    expect(backToTop.hidden).toBe(true);
    expect(backToTop.classList.contains("back-to-top-button")).toBe(true);

    home.scrollTop = 57;
    home.dispatchEvent(new Event("scroll"));
    expect(backToTop.hidden).toBe(false);

    backToTop.click();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
