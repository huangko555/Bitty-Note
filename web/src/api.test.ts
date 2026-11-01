import { afterEach, describe, expect, it, vi } from "vitest";

import { connectApi } from "./api";

describe("browser preview summaries", () => {
  afterEach(() => {
    delete window.pywebview;
  });

  it("hides supported text highlight markers from active and archived notes", async () => {
    const api = await connectApi();
    const note = await api.createNote("Preview");
    await api.saveNote(note, "# 标题\n1. =={red}2313==\n- ==默认高亮==");

    expect((await api.listNotes())[0]?.preview).toBe("标题 2313 默认高亮");

    await api.archiveNote(note.name);

    expect((await api.listArchivedNotes())[0]?.preview).toBe("标题 2313 默认高亮");
  });
});


describe("packaged native bridge startup", () => {
  afterEach(() => {
    delete window.pywebview;
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("never substitutes preview notes when the packaged bridge times out", async () => {
    vi.stubEnv("DEV", false);
    vi.useFakeTimers();
    const result = connectApi().then(() => "resolved", () => "rejected");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBe("rejected");
  });

  it("connects immediately when pywebview signals readiness", async () => {
    vi.stubEnv("DEV", false);
    vi.useFakeTimers();
    const resolved = vi.fn();
    const pending = connectApi().then(resolved);
    window.pywebview = { api: { bootstrap: vi.fn() } } as unknown as Window["pywebview"];
    window.dispatchEvent(new Event("pywebviewready"));
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toHaveBeenCalledOnce();
    await pending;
  });
});
