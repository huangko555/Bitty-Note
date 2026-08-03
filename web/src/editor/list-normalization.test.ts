import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import { listNormalizationPlugin } from "./list-normalization";
import { noteSchema } from "./schema";

function item(text: string, blocks: ProseMirrorNode[] = []): ProseMirrorNode {
  return noteSchema.nodes.list_item.create(null, [
    noteSchema.nodes.paragraph.create(null, noteSchema.text(text)),
    ...blocks,
  ]);
}

function ordered(order: number, ...items: ProseMirrorNode[]): ProseMirrorNode {
  return noteSchema.nodes.ordered_list.create({ order }, items);
}

function normalizeAfterEdit(doc: ProseMirrorNode): ProseMirrorNode {
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 3),
    plugins: [listNormalizationPlugin()],
  });
  return state.apply(state.tr.insertText("!", 3)).doc;
}

describe("ordered-list numbering normalization", () => {
  it("merges adjacent ordered lists at the same level", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      ordered(4, item("第一项")),
      ordered(9, item("第二项")),
    ]);

    const normalized = normalizeAfterEdit(doc);

    expect(normalized.childCount).toBe(1);
    expect(normalized.firstChild?.type).toBe(noteSchema.nodes.ordered_list);
    expect(normalized.firstChild?.attrs.order).toBe(1);
    expect(normalized.firstChild?.childCount).toBe(2);
  });

  it.each([
    ["normal text", noteSchema.nodes.paragraph.create(null, noteSchema.text("正文"))],
    ["blank line", noteSchema.nodes.paragraph.create()],
    ["another list", noteSchema.nodes.bullet_list.create(null, item("无序项"))],
  ])("restarts after %s interrupts the sequence", (_name, separator) => {
    const doc = noteSchema.nodes.doc.create(null, [
      ordered(4, item("第一项")),
      separator,
      ordered(9, item("第二项")),
    ]);

    const normalized = normalizeAfterEdit(doc);

    expect(normalized.childCount).toBe(3);
    expect(normalized.child(0).attrs.order).toBe(1);
    expect(normalized.child(2).attrs.order).toBe(1);
  });

  it("normalizes nested sequences independently without breaking the parent sequence", () => {
    const doc = noteSchema.nodes.doc.create(null, ordered(
      6,
      item("父项一", [
        ordered(3, item("子项一")),
        ordered(8, item("子项二")),
      ]),
      item("父项二"),
    ));

    const normalized = normalizeAfterEdit(doc);
    const outer = normalized.firstChild!;
    const nested = outer.firstChild!.lastChild!;

    expect(outer.attrs.order).toBe(1);
    expect(outer.childCount).toBe(2);
    expect(nested.type).toBe(noteSchema.nodes.ordered_list);
    expect(nested.attrs.order).toBe(1);
    expect(nested.childCount).toBe(2);
  });
});
