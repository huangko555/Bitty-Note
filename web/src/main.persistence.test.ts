import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "./api";
import type { BootstrapData, OpenedNote, SaveResult } from "./types";

const captured = vi.hoisted(() => ({ connectApi: vi.fn(), onChange: (_value: string) => {}, renders: 0 }));
vi.mock("./api", () => ({ connectApi: captured.connectApi }));
vi.mock("./editor/editor", () => ({
  handleWindowEditorHistoryShortcut: vi.fn(),
  createEditor: (host: HTMLElement, content: string, callbacks: { onChange(value: string): void }) => {
    captured.onChange = callbacks.onChange;
    captured.renders += 1;
    const element = document.createElement("div");
    element.className = "ProseMirror";
    element.textContent = content;
    host.append(element);
    return {
      snapshot: { mode: "wysiwyg", markdown: content },
      controller: {
        mode: "wysiwyg", destroy: () => element.remove(), focus: vi.fn(), clearSelection: vi.fn(),
        activeActions: () => new Set(), highlightState: () => null, ensureSelectionVisible: vi.fn(),
      },
    };
  },
}));

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
    auto_update: true,
    last_update_check_ms: null,
    available_version: null,
    downloaded_update_version: null,
    pending_update_version: null,
    automatic_update_error_version: null,
  },
  notes: [],
  system_fonts: [],
  app_version: "1.4.0",
  update_state: { status: "idle", available_version: null, auto_update: true },
  update_result: null,
  window_role: "note",
  initial_note: note.name,
};

const saved = (revision: string): SaveResult => ({ status: "saved", revision, external_content: null, has_bom: false, newline: "\n" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class ResizeObserverStub { observe(): void {} disconnect(): void {} }
let api: DesktopApi;
let listeners: [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][];

describe("note persistence under asynchronous operations", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
    captured.renders = 0;
    listeners = [];
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      listeners.push([type, listener, options]);
      add(type, listener, options);
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(window, "setInterval").mockReturnValue(0);
    api = {
      bootstrap: vi.fn().mockResolvedValue({ ...bootstrap, initial_note_data: { ...note } }),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      rememberLastNote: vi.fn().mockResolvedValue(undefined),
      listNotes: vi.fn().mockResolvedValue([]),
      saveNote: vi.fn().mockResolvedValue(saved("revision-2")),
      openNote: vi.fn().mockResolvedValue({ ...note }),
      renameNote: vi.fn(),
      setUpdateReady: vi.fn().mockResolvedValue(undefined),
      windowReady: vi.fn().mockResolvedValue(undefined),
      showMainWindow: vi.fn().mockResolvedValue(undefined),
      closeWindow: vi.fn().mockResolvedValue(undefined),
      cancelClose: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
    captured.connectApi.mockResolvedValue(api);
    await import("./main");
    await vi.waitFor(() => expect(api.windowReady).toHaveBeenCalled());
  });

  afterEach(() => {
    for (const [type, listener, options] of listeners) window.removeEventListener(type, listener, options);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    document.documentElement.className = "";
  });

  it("waits for edits made during a save before closing", async () => {
    const first = deferred<SaveResult>();
    vi.mocked(api.saveNote).mockReturnValueOnce(first.promise);
    captured.onChange("first edit");
    window.desktopNotesRequestClose?.();
    await vi.waitFor(() => expect(api.saveNote).toHaveBeenCalledTimes(1));
    captured.onChange("last edit");
    first.resolve(saved("revision-2"));
    await vi.waitFor(() => expect(api.closeWindow).toHaveBeenCalledOnce());
    expect(api.saveNote).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.saveNote).mock.calls[1]?.[1]).toBe("last edit");
  });

  it("saves a background change made while the content save is pending", async () => {
    const first = deferred<SaveResult>();
    const writes: { background: unknown; content: string }[] = [];
    vi.mocked(api.saveNote).mockImplementation((value, content) => {
      writes.push({ background: value.background, content });
      return writes.length === 1 ? first.promise : Promise.resolve(saved("revision-3"));
    });
    captured.onChange("edited content");
    await vi.advanceTimersByTimeAsync(400);
    document.querySelector<HTMLButtonElement>('[data-action="note-menu"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-background="mint"]')!.click();
    first.resolve(saved("revision-2"));
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toEqual([
      { background: "sky", content: "edited content" },
      { background: "mint", content: "edited content" },
    ]);
  });

  it("preserves typing while a rename request is in flight", async () => {
    const renamed = deferred<OpenedNote>();
    vi.mocked(api.renameNote).mockReturnValue(renamed.promise);
    const title = document.querySelector<HTMLElement>(".window-title")!;
    title.click(); title.click();
    const input = document.querySelector<HTMLInputElement>(".title-rename-input")!;
    input.value = "Renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(api.renameNote).toHaveBeenCalledOnce());
    captured.onChange("typed during rename");
    renamed.resolve({ ...note, name: "Renamed.md" });
    await vi.advanceTimersByTimeAsync(500);
    expect(api.saveNote).toHaveBeenCalled();
    expect(vi.mocked(api.saveNote).mock.calls.at(-1)?.[0].name).toBe("Renamed.md");
    expect(vi.mocked(api.saveNote).mock.calls.at(-1)?.[1]).toBe("typed during rename");
  });

  it("ignores an external-read response captured before a newer save", async () => {
    const disk = deferred<OpenedNote>();
    vi.mocked(api.openNote).mockReturnValue(disk.promise);
    window.dispatchEvent(new Event("focus"));
    captured.onChange("newest local edit");
    await vi.advanceTimersByTimeAsync(400);
    disk.resolve({ ...note, revision: "older-disk-revision", content: "stale disk snapshot" });
    await vi.advanceTimersByTimeAsync(0);
    expect(captured.renders).toBe(1);
  });

  it("does not close a note on a temporary read error", async () => {
    vi.mocked(api.openNote).mockRejectedValue(new Error("temporary file lock"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.closeWindow).not.toHaveBeenCalled();
    expect(api.showMainWindow).not.toHaveBeenCalled();
  });
});
