import type { NoteBackground, OpenedNote, SaveResult } from "./types";

export type SaveIssue =
  | { kind: "conflict"; result: SaveResult }
  | { kind: "missing" }
  | { kind: "error"; error: unknown };

type WriteNote = (note: OpenedNote, content: string, force: boolean) => Promise<SaveResult>;

/** Owns the current draft, serial writes, and stale-response checks for one window. */
export class NoteSession {
  private saved: OpenedNote | null = null;
  private draft = "";
  private background: NoteBackground = "default";
  private generation = 0;
  private identity = 0;
  private blocked = false;
  private pendingSave: Promise<boolean> | null = null;
  private pendingMutation: Promise<OpenedNote | null> | null = null;
  private reading = false;

  constructor(
    private readonly write: WriteNote,
    private readonly onIssue: (issue: SaveIssue) => void,
    private readonly onStateChange: () => void = () => {},
  ) {}

  get note(): OpenedNote | null {
    return this.saved ? { ...this.saved, background: this.background } : null;
  }
  get content(): string { return this.draft; }
  get dirty(): boolean {
    return this.saved !== null && (
      this.draft !== this.saved.content || this.background !== (this.saved.background ?? "default")
    );
  }
  get saving(): boolean { return this.pendingSave !== null || this.pendingMutation !== null; }
  get locked(): boolean { return this.blocked; }

  load(note: OpenedNote | null, renderedContent = note?.content ?? ""): void {
    this.identity += 1;
    this.generation += 1;
    this.saved = note ? { ...note, content: renderedContent } : null;
    this.draft = renderedContent;
    this.background = note?.background ?? "default";
    this.blocked = false;
    this.onStateChange();
  }

  edit(change: { content?: string; background?: NoteBackground }): void {
    if (!this.saved) return;
    if (change.content !== undefined) this.draft = change.content;
    if (change.background !== undefined) this.background = change.background;
    this.generation += 1;
    this.onStateChange();
  }

  block(): void {
    this.blocked = true;
    this.onStateChange();
  }

  resume(revision?: string): void {
    if (revision && this.saved) this.saved = { ...this.saved, revision };
    this.blocked = false;
    this.onStateChange();
  }

  async flush(force = false): Promise<boolean> {
    if (this.pendingMutation) {
      try {
        if (!(await this.pendingMutation)) return false;
      } catch {
        return false;
      }
    }
    if (this.pendingSave) return this.pendingSave;
    if (!this.saved) return true;
    if (this.blocked && !force) return false;
    if (!this.dirty && !force) return true;
    const pending = this.saveUntilCurrent(force);
    this.pendingSave = pending;
    this.onStateChange();
    try {
      return await pending;
    } finally {
      if (this.pendingSave === pending) this.pendingSave = null;
      this.onStateChange();
    }
  }

  async rename(
    requestedName: string,
    rename: (note: OpenedNote, name: string) => Promise<OpenedNote>,
  ): Promise<OpenedNote | null> {
    if (!(await this.flush())) return null;
    return this.replacePersisted((note) => rename(note, requestedName), true);
  }

  async recreate(
    recreate: (note: OpenedNote, content: string) => Promise<OpenedNote>,
  ): Promise<OpenedNote | null> {
    return this.replacePersisted(recreate);
  }

  async refresh(read: (name: string) => Promise<OpenedNote>): Promise<OpenedNote | null> {
    if (!this.saved || this.saving || this.blocked || this.reading) return null;
    const { identity, generation } = this;
    const revision = this.saved.revision;
    const stillCurrent = () => this.identity === identity && this.generation === generation
      && this.saved?.revision === revision && !this.saving && !this.blocked;
    this.reading = true;
    try {
      const disk = await read(this.saved.name);
      if (!stillCurrent() || disk.revision === revision) return null;
      if (!this.dirty) return disk;
      this.conflictWith(disk);
      return null;
    } catch (error) {
      if (stillCurrent()) throw error;
      return null;
    } finally {
      this.reading = false;
    }
  }

  private async saveUntilCurrent(force: boolean): Promise<boolean> {
    const identity = this.identity;
    while (this.saved && (this.dirty || force)) {
      const snapshot = { ...this.saved, content: this.draft, background: this.background };
      try {
        const result = await this.write(snapshot, snapshot.content, force);
        force = false;
        if (this.identity !== identity) return false;
        if (result.status === "saved" || result.status === "unchanged") {
          this.saved = { ...snapshot, revision: result.revision ?? snapshot.revision };
          this.blocked = false;
          this.onStateChange();
          continue;
        }
        this.block();
        this.onIssue(result.status === "conflict" ? { kind: "conflict", result } : { kind: "missing" });
        return false;
      } catch (error) {
        if (this.identity !== identity) return false;
        this.block();
        this.onIssue({ kind: "error", error });
        return false;
      }
    }
    return true;
  }

  private conflictWith(disk: OpenedNote): void {
    this.block();
    this.onIssue({ kind: "conflict", result: {
      status: "conflict", revision: disk.revision, external_content: disk.content,
      has_bom: disk.has_bom, newline: disk.newline, external_background: disk.background,
    } });
  }

  private async replacePersisted(
    replace: (note: OpenedNote, content: string) => Promise<OpenedNote>,
    checkExternalChange = false,
  ): Promise<OpenedNote | null> {
    if (this.pendingMutation) await this.pendingMutation;
    if (!this.saved) return null;
    const { identity, generation } = this;
    const snapshot = { ...this.saved, background: this.background };
    const content = this.draft;
    const pending = (async () => {
      const replacement = await replace(snapshot, content);
      if (this.identity !== identity) return null;
      if (checkExternalChange && this.generation !== generation && replacement.revision !== snapshot.revision) {
        this.saved = { ...snapshot, name: replacement.name };
        this.generation += 1;
        this.conflictWith(replacement);
        return this.note;
      }
      this.saved = { ...replacement };
      if (this.generation === generation) {
        this.draft = replacement.content;
        this.background = replacement.background ?? "default";
      }
      this.generation += 1;
      this.blocked = false;
      return this.note;
    })();
    this.pendingMutation = pending;
    this.onStateChange();
    try {
      return await pending;
    } finally {
      if (this.pendingMutation === pending) this.pendingMutation = null;
      this.onStateChange();
    }
  }
}
