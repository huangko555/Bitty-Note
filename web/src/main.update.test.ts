import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopApi } from "./api";
import type { BootstrapData, UpdateState } from "./types";

const { connectApi } = vi.hoisted(() => ({
  connectApi: vi.fn(),
}));

vi.mock("./api", () => ({ connectApi }));

const bootstrap: BootstrapData = {
  config: {
    save_dir: "C:\\Notes",
    language: "en",
    autostart: false,
    always_on_top: false,
    window_x: null,
    window_y: null,
    window_width: 350,
    window_height: 530,
    last_note: null,
    editor_font: "DengXian",
    editor_font_size: 14,
    spellcheck: false,
    heading_divider: true,
    heading_list_highlight: true,
    editor_highlight_color: "#456FC4",
    last_update_check_ms: null,
    available_version: "1.1.3",
    pending_update_version: null,
  },
  notes: [],
  system_fonts: [],
  app_version: "1.1.2",
  update_state: { status: "available", available_version: "1.1.3" },
  update_result: null,
};

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

describe("available update interaction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    connectApi.mockReset();
    document.body.replaceChildren();
  });

  it("shows a persistent download state and restores the available state after failure", async () => {
    let rejectInstall!: (error: Error) => void;
    const installUpdate = vi.fn(() => new Promise<UpdateState>((_resolve, reject) => {
      rejectInstall = reject;
    }));
    const api = {
      bootstrap: vi.fn().mockResolvedValue(bootstrap),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      rememberLastNote: vi.fn().mockResolvedValue(undefined),
      checkUpdate: vi.fn().mockResolvedValue(bootstrap.update_state),
      installUpdate,
    } as unknown as DesktopApi;
    connectApi.mockResolvedValue(api);

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector('[data-action="settings"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();

    const updateButton = document.querySelector<HTMLButtonElement>('[data-action="update"]')!;
    updateButton.click();
    updateButton.click();

    expect(installUpdate).toHaveBeenCalledTimes(1);
    expect(updateButton.disabled).toBe(true);
    expect(updateButton.classList.contains("is-downloading")).toBe(true);
    expect(updateButton.classList.contains("has-update")).toBe(false);
    expect(document.querySelector(".toast")?.textContent).toBe("Downloading update, please wait");

    rejectInstall(new Error("network failed"));
    await vi.waitFor(() => expect(updateButton.disabled).toBe(false));

    expect(updateButton.classList.contains("is-downloading")).toBe(false);
    expect(updateButton.classList.contains("has-update")).toBe(true);
    expect(document.querySelector(".toast")?.textContent).toBe(
      "Automatic update failed. Please download it manually from GitHub",
    );
  });

  it("keeps the Microsoft Store update flow unchanged", async () => {
    const storeBootstrap: BootstrapData = {
      ...bootstrap,
      config: { ...bootstrap.config, available_version: null },
      update_state: { status: "store", available_version: null },
    };
    const installUpdate = vi.fn().mockResolvedValue(storeBootstrap.update_state);
    const api = {
      bootstrap: vi.fn().mockResolvedValue(storeBootstrap),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      rememberLastNote: vi.fn().mockResolvedValue(undefined),
      checkUpdate: vi.fn().mockResolvedValue(storeBootstrap.update_state),
      installUpdate,
    } as unknown as DesktopApi;
    connectApi.mockResolvedValue(api);

    await import("./main");
    await vi.waitFor(() => expect(document.querySelector('[data-action="settings"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();

    const updateButton = document.querySelector<HTMLButtonElement>('[data-action="update"]')!;
    updateButton.click();
    await vi.waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());

    expect(updateButton.classList.contains("is-downloading")).toBe(false);
    expect(document.querySelector(".toast")?.textContent).toBe("Microsoft Store updates opened");
  });
});
