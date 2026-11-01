// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NoteSession } from "./note-session";
import type { OpenedNote, SaveResult } from "./types";

const note: OpenedNote = { name: "Note.md", content: "saved", revision: "r1", has_bom: false, newline: "\n", background: "sky" };
const saved = (revision: string): SaveResult => ({ status: "saved", revision, external_content: null, has_bom: false, newline: "\n" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("note session", () => {
  it("joins simultaneous flushes and drains edits received during a write", async () => {
    const first = deferred<SaveResult>();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(saved("r3"));
    const session = new NoteSession(write, vi.fn());
    session.load(note);
    session.edit({ content: "first" });
    const closing = session.flush();
    const secondCaller = session.flush();
    session.edit({ content: "latest", background: "mint" });
    first.resolve(saved("r2"));
    expect(await closing).toBe(true);
    expect(await secondCaller).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![0]).toMatchObject({ revision: "r2", background: "mint" });
    expect(write.mock.calls[1]![1]).toBe("latest");
    expect(session.dirty).toBe(false);
  });

  it("keeps a failed or conflicting draft blocked even when text matches the old baseline", async () => {
    const write = vi.fn();
    const session = new NoteSession(write, vi.fn());
    session.load(note);
    session.block();
    expect(await session.flush()).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("retains edits while blocked and saves them only after explicit resume", async () => {
    const write = vi.fn().mockResolvedValue(saved("r2"));
    const session = new NoteSession(write, vi.fn());
    session.load(note);
    session.block();
    session.edit({ content: "kept for retry" });
    expect(await session.flush()).toBe(false);
    expect(session.content).toBe("kept for retry");
    session.resume();
    expect(await session.flush()).toBe(true);
    expect(write.mock.calls[0]![1]).toBe("kept for retry");
  });

  it("does not apply an old write response to a newly loaded note", async () => {
    const pending = deferred<SaveResult>();
    const session = new NoteSession(() => pending.promise, vi.fn());
    session.load(note);
    session.edit({ content: "old draft" });
    const saving = session.flush();
    session.load({ ...note, name: "Other.md", content: "other", revision: "other-r1" });
    pending.resolve(saved("old-r2"));
    expect(await saving).toBe(false);
    expect(session.note).toMatchObject({ name: "Other.md", content: "other", revision: "other-r1" });
  });

  it("cancels a close waiting for a rename that fails", async () => {
    const pending = deferred<OpenedNote>();
    const rename = vi.fn(() => pending.promise);
    const session = new NoteSession(vi.fn(), vi.fn());
    session.load(note);
    const renaming = session.rename("Renamed", rename);
    await vi.waitFor(() => expect(rename).toHaveBeenCalled());
    const closing = session.flush();
    const rejectedRename = expect(renaming).rejects.toThrow("rename failed");
    const cancelledClose = expect(closing).resolves.toBe(false);
    pending.reject(new Error("rename failed"));
    await rejectedRename;
    await cancelledClose;
  });

  it("requires conflict resolution if local and external text change during a rename", async () => {
    const pending = deferred<OpenedNote>();
    const issue = vi.fn();
    const rename = vi.fn(() => pending.promise);
    const session = new NoteSession(vi.fn(), issue);
    session.load(note);
    const renaming = session.rename("Renamed", rename);
    await vi.waitFor(() => expect(rename).toHaveBeenCalled());
    session.edit({ content: "local edit during rename" });
    pending.resolve({ ...note, name: "Renamed.md", revision: "external-r2", content: "external edit" });
    await renaming;
    expect(session.note?.name).toBe("Renamed.md");
    expect(session.content).toBe("local edit during rename");
    expect(session.locked).toBe(true);
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ kind: "conflict" }));
    expect(await session.flush()).toBe(false);
  });
});
