import { describe, expect, it } from "vitest";

import { parseMarkdown, serializeMarkdown } from "./markdown";
import { noteSchema } from "./schema";

describe("strict Markdown mode selection", () => {
  it("renders supported inline formatting as marks", () => {
    const parsed = parseMarkdown(
      "Preview **bold** and *italic*.\n\n~~Deleted text.~~\n",
    );
    if (parsed.mode === "raw") throw new Error(parsed.reason);

    const marks = new Set<string>();
    parsed.doc.descendants((node) => {
      node.marks.forEach((mark) => marks.add(mark.type.name));
    });

    expect(marks).toEqual(new Set(["strong", "em", "strike"]));
  });

  it("round-trips the supported canonical subset", () => {
    const source = "# 标题\n\n正文有 **粗体**、*斜体* 和 ~~删除线~~。\n\n- 项目\n- [ ] 任务\n";
    const parsed = parseMarkdown(source);

    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(parsed).toMatchObject({ mode: "wysiwyg" });
    if (parsed.mode === "wysiwyg") expect(serializeMarkdown(parsed.doc)).toBe(source);
  });

  it.each([
    ["## 二级标题\n", "二级"],
    ["[链接](https://example.com)\n", "link"],
    ["第一行\n第二行\n", "softbreak"],
    ["```text\ncode\n```\n", "fence"],
    ["| A | B |\n| --- | --- |\n| 1 | 2 |\n", "表格"],
  ])("keeps unsupported Markdown as an editable raw block: %s", (source) => {
    const parsed = parseMarkdown(source);
    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      expect(parsed.doc.firstChild?.type.name).toBe("raw_block");
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it("renders supported blocks around an unsupported block", () => {
    const source = "# 标题\n\n[链接](https://example.com)\n\n- 第一项\n- 第二项\n";
    const parsed = parseMarkdown(source);

    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(Array.from({ length: parsed.doc.childCount }, (_, index) =>
      parsed.doc.child(index).type.name,
    )).toEqual(["heading", "raw_block", "bullet_list"]);
    expect(serializeMarkdown(parsed.doc)).toBe(source);
  });

  it("accepts harmless extra blank lines instead of switching modes", () => {
    const parsed = parseMarkdown("- [ ] 第一项\n\n\n- [ ] 第二项\n");
    expect(parsed.mode).toBe("wysiwyg");
  });

  it("keeps an editable blank paragraph after saving and reopening", () => {
    const paragraph = (text?: string) => noteSchema.nodes.paragraph.create(
      null,
      text ? noteSchema.text(text) : undefined,
    );
    const original = noteSchema.nodes.doc.create(null, [
      paragraph("第一段"),
      paragraph(),
      paragraph("第二段"),
    ]);

    const saved = serializeMarkdown(original);
    const reopened = parseMarkdown(saved);

    expect(reopened.mode).toBe("wysiwyg");
    if (reopened.mode === "wysiwyg") {
      expect(reopened.doc.childCount).toBe(3);
      expect(reopened.doc.child(1).type).toBe(noteSchema.nodes.paragraph);
      expect(reopened.doc.child(1).content.size).toBe(0);
    }
  });

  it.each([
    ["单个文末", ["正文", ""]],
    ["文末", ["正文", "", ""]],
    ["文首", ["", "正文"]],
    ["连续", ["第一段", "", "", "第二段"]],
  ])("keeps %s blank paragraphs after saving and reopening", (_label, contents) => {
    const original = noteSchema.nodes.doc.create(
      null,
      contents.map((text) => noteSchema.nodes.paragraph.create(
        null,
        text ? noteSchema.text(text) : undefined,
      )),
    );

    const saved = serializeMarkdown(original);
    const reopened = parseMarkdown(saved);

    expect(reopened.mode).toBe("wysiwyg");
    if (reopened.mode === "wysiwyg") {
      expect(Array.from({ length: reopened.doc.childCount }, (_, index) =>
        reopened.doc.child(index).textContent,
      )).toEqual(contents);
    }
  });

  it("accepts files that only omit the final newline", () => {
    const parsed = parseMarkdown("普通正文");
    expect(parsed.mode).toBe("wysiwyg");
  });

  it("keeps an empty paragraph inside a list item", () => {
    const paragraph = (text?: string) => noteSchema.nodes.paragraph.create(
      null,
      text ? noteSchema.text(text) : undefined,
    );
    const item = noteSchema.nodes.list_item.create(
      { checked: null },
      [paragraph("列表首段"), paragraph(), paragraph("列表末段")],
    );
    const original = noteSchema.nodes.doc.create(
      null,
      noteSchema.nodes.bullet_list.create(null, item),
    );

    const saved = serializeMarkdown(original);
    const reopened = parseMarkdown(saved);

    expect(reopened.mode).toBe("wysiwyg");
    if (reopened.mode === "wysiwyg") {
      const reopenedItem = reopened.doc.firstChild?.firstChild;
      expect(Array.from({ length: reopenedItem?.childCount ?? 0 }, (_, index) =>
        reopenedItem!.child(index).textContent,
      ), saved).toEqual(["列表首段", "", "列表末段"]);
    }
  });
});
