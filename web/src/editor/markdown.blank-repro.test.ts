import type { Node as ProseMirrorNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";

import { parseMarkdown, serializeMarkdown } from "./markdown";
import { noteSchema } from "./schema";

const paragraph = (text = "") => noteSchema.nodes.paragraph.create(
  null,
  text ? noteSchema.text(text) : undefined,
);
const heading = (text: string) => noteSchema.nodes.heading.create(
  { level: 1 },
  noteSchema.text(text),
);
const list = (text: string) => noteSchema.nodes.bullet_list.create(
  null,
  noteSchema.nodes.list_item.create({ checked: null }, paragraph(text)),
);

function fingerprint(node: ProseMirrorNode): unknown {
  return {
    type: node.type.name,
    text: node.isTextblock ? node.textContent : undefined,
    children: Array.from({ length: node.childCount }, (_, index) =>
      fingerprint(node.child(index))),
  };
}

describe("blank line persistence reproduction", () => {
  it.each([
    ["between paragraphs", [paragraph("first"), paragraph(), paragraph("last")]],
    ["after a heading", [heading("Title"), paragraph(), paragraph("body")]],
    ["before a heading", [paragraph("body"), paragraph(), heading("Title")]],
    ["after a list", [list("item"), paragraph(), paragraph("body")]],
    ["before a list", [paragraph("body"), paragraph(), list("item")]],
    ["only blank lines", [paragraph(), paragraph(), paragraph()]],
  ])("keeps a pure blank line %s", (_label, blocks) => {
    const original = noteSchema.nodes.doc.create(null, blocks);
    const saved = serializeMarkdown(original);
    const reopened = parseMarkdown(saved);

    const blankCount = blocks.filter((node) =>
      node.type === noteSchema.nodes.paragraph && node.content.size === 0).length;
    expect(saved.match(/<!-- bitty-empty-line -->/g)?.length ?? 0).toBe(blankCount);

    expect(reopened.mode).toBe("wysiwyg");
    if (reopened.mode === "wysiwyg") {
      expect(fingerprint(reopened.doc)).toEqual(fingerprint(original));
    }
  });
});
