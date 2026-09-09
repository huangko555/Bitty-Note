import { afterEach, describe, expect, it } from "vitest";

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
