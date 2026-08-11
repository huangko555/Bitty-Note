import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";

import { recoverClickedTextblockSelection } from "./click-selection";
import { noteSchema } from "./schema";

describe("clicked textblock selection recovery", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it("moves a stale heading selection into the textblock that was actually clicked", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("Title")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("child")),
    ]);
    const frames: FrameRequestCallback[] = [];
    view = new EditorView(host, {
      state: EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
      }),
    });
    const child = host.querySelector("p")!;

    recoverClickedTextblockSelection(view, child, (callback) => {
      frames.push(callback);
      return frames.length;
    });
    frames.shift()?.(0);
    frames.shift()?.(16);

    expect(view.state.selection.$from.parent.textContent).toBe("child");
    expect(view.state.selection.$from.parentOffset).toBe(5);
  });

  it("leaves a valid selection in the clicked textblock unchanged", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.paragraph.create(null, noteSchema.text("child")),
    ]);
    const frames: FrameRequestCallback[] = [];
    view = new EditorView(host, {
      state: EditorState.create({
        doc,
        selection: TextSelection.create(doc, 3),
      }),
    });
    const child = host.querySelector("p")!;

    recoverClickedTextblockSelection(view, child, (callback) => {
      frames.push(callback);
      return frames.length;
    });
    frames.shift()?.(0);
    frames.shift()?.(16);

    expect(view.state.selection.from).toBe(3);
  });

  it("recovers a click inside a nested list textblock", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const child = noteSchema.nodes.paragraph.create(null, noteSchema.text("design"));
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("Title")),
      noteSchema.nodes.bullet_list.create(null, noteSchema.nodes.list_item.create(
        { checked: true },
        child,
      )),
    ]);
    const frames: FrameRequestCallback[] = [];
    view = new EditorView(host, {
      state: EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
      }),
    });

    recoverClickedTextblockSelection(view, host.querySelector("p")!, (callback) => {
      frames.push(callback);
      return frames.length;
    });
    frames.shift()?.(0);
    frames.shift()?.(16);

    expect(view.state.selection.$from.parent.textContent).toBe("design");
    expect(view.state.selection.$from.parentOffset).toBe(6);
  });

  it("recovers after native selection regresses following the first frame", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = noteSchema.nodes.doc.create(null, [
      noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text("Title")),
      noteSchema.nodes.paragraph.create(null, noteSchema.text("child")),
    ]);
    const frames: FrameRequestCallback[] = [];
    view = new EditorView(host, {
      state: EditorState.create({
        doc,
        selection: TextSelection.create(doc, 1),
      }),
    });

    recoverClickedTextblockSelection(view, host.querySelector("p")!, (callback) => {
      frames.push(callback);
      return frames.length;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, 10)));
    frames.shift()?.(0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, 1)));
    frames.shift()?.(16);

    expect(view.state.selection.$from.parent.textContent).toBe("child");
  });
});
