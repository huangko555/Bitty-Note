import { describe, expect, it } from "vitest";
import { DOMSerializer } from "prosemirror-model";
import { EditorState } from "prosemirror-state";

import { parseMarkdown, serializeMarkdown } from "./markdown";
import { noteSchema } from "./schema";

describe("toolbar Markdown syntax", () => {
  it("renders supported inline formatting as marks", () => {
    const parsed = parseMarkdown(
      "Preview **bold**, *italic* and ==highlighted==.\n\n~~Deleted text.~~\n",
    );
    if (parsed.mode === "raw") throw new Error(parsed.reason);

    const marks = new Set<string>();
    parsed.doc.descendants((node) => {
      node.marks.forEach((mark) => marks.add(mark.type.name));
    });

    expect(marks).toEqual(new Set(["strong", "em", "highlight", "strike"]));
  });

  it("round-trips highlighted text with double equals markers", () => {
    const source = "正文包含 ==浅绿色高亮== 文字。\n";
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      const highlighted: string[] = [];
      parsed.doc.descendants((node) => {
        if (noteSchema.marks.highlight.isInSet(node.marks)) {
          highlighted.push(node.textContent);
        }
      });
      expect(highlighted).toEqual(["浅绿色高亮"]);
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it("round-trips named highlight colors while keeping green syntax compatible", () => {
    const source = "==绿色== =={red}红色== =={yellow}黄色== =={blue}蓝色==\n";
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      const colors: string[] = [];
      parsed.doc.descendants((node) => {
        const mark = noteSchema.marks.highlight.isInSet(node.marks);
        if (mark) colors.push(mark.attrs.color as string);
      });
      expect(colors).toEqual(["green", "red", "yellow", "blue"]);
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it("round-trips adjacent highlight spans with different colors", () => {
    const source = "=={red}前===={blue}中===={red}后==\n";
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      const segments: Array<[string, string]> = [];
      parsed.doc.descendants((node) => {
        const mark = noteSchema.marks.highlight.isInSet(node.marks);
        if (node.isText && mark) {
          segments.push([node.text ?? "", String(mark.attrs.color)]);
        }
      });
      expect(parsed.doc.textContent).toBe("前中后");
      expect(segments).toEqual([
        ["前", "red"],
        ["中", "blue"],
        ["后", "red"],
      ]);
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it("round-trips every color transition across text and punctuation boundaries", () => {
    const colors = ["red", "yellow", "blue", "green"] as const;
    const boundaries = [
      ["（", "字"],
      ["字", "）"],
      ["下", "一"],
    ] as const;
    const open = (color: typeof colors[number]) => color === "green"
      ? "=="
      : `=={${color}}`;

    for (const previousColor of colors) {
      for (const nextColor of colors) {
        if (previousColor === nextColor) continue;
        for (const [left, right] of boundaries) {
          const source = `${open(previousColor)}${left}==${open(nextColor)}${right}==\n`;
          const parsed = parseMarkdown(source);
          expect(parsed.mode).toBe("wysiwyg");
          if (parsed.mode !== "wysiwyg") continue;

          const segments: Array<[string, string]> = [];
          parsed.doc.descendants((node) => {
            const mark = noteSchema.marks.highlight.isInSet(node.marks);
            if (node.isText && mark) {
              segments.push([node.text ?? "", String(mark.attrs.color)]);
            }
          });
          expect(parsed.doc.textContent).toBe(`${left}${right}`);
          expect(segments).toEqual([
            [left, previousColor],
            [right, nextColor],
          ]);
          expect(serializeMarkdown(parsed.doc)).toBe(source);
        }
      }
    }
  });

  it("parses a named highlight that starts in the middle of a word", () => {
    const source = "前=={blue}中==后\n";
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      const middle = parsed.doc.firstChild?.child(1);
      const mark = middle && noteSchema.marks.highlight.isInSet(middle.marks);
      expect(parsed.doc.textContent).toBe("前中后");
      expect(middle?.textContent).toBe("中");
      expect(mark?.attrs.color).toBe("blue");
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it.each([
    ["=={red}一行（==子列表？）\n", "red", "一行（", "一行（子列表？）"],
    ["==（==子列表？）\n", "green", "（", "（子列表？）"],
  ])("closes a %s highlight after opening punctuation", (
    source,
    color,
    highlighted,
    expectedText,
  ) => {
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      const markNode = parsed.doc.firstChild?.firstChild;
      const mark = markNode && noteSchema.marks.highlight.isInSet(markNode.marks);
      expect(parsed.doc.textContent).toBe(expectedText);
      expect(markNode?.textContent).toBe(highlighted);
      expect(mark?.attrs.color).toBe(color);
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it("keeps spaced equality operators as literal text", () => {
    const source = "比较 a == b == c\n";
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      expect(parsed.doc.textContent).toBe("比较 a == b == c");
      expect(parsed.doc.firstChild?.firstChild?.marks).toHaveLength(0);
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it.each([
    ["==甲===={red}乙====丙==\n", ["green", "red", "green"]],
    ["=={red}甲====乙===={blue}丙==\n", ["red", "green", "blue"]],
  ])("round-trips default and named color boundaries in %j", (source, expectedColors) => {
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      const colors: string[] = [];
      parsed.doc.descendants((node) => {
        const mark = noteSchema.marks.highlight.isInSet(node.marks);
        if (node.isText && mark) colors.push(String(mark.attrs.color));
      });
      expect(parsed.doc.textContent).toBe("甲乙丙");
      expect(colors).toEqual(expectedColors);
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it("accepts explicit green syntax but serializes its canonical shorthand", () => {
    const parsed = parseMarkdown("=={green}绿色==\n");

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      expect(serializeMarkdown(parsed.doc)).toBe("==绿色==\n");
    }
  });

  it("keeps unknown highlight colors as literal text", () => {
    const source = "=={orange}橙色文字==\n";
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      expect(parsed.doc.firstChild?.textContent).toBe("=={orange}橙色文字==");
      expect(parsed.doc.firstChild?.firstChild?.marks).toHaveLength(0);
      expect(serializeMarkdown(parsed.doc)).toBe(source);
    }
  });

  it("round-trips the supported canonical subset", () => {
    const source = "# 标题\n\n正文有 **粗体**、*斜体*、==高亮== 和 ~~删除线~~。\n\n- 项目\n- [ ] 任务\n";
    const parsed = parseMarkdown(source);

    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(parsed).toMatchObject({ mode: "wysiwyg" });
    if (parsed.mode === "wysiwyg") expect(serializeMarkdown(parsed.doc)).toBe(source);
  });

  it("round-trips folded headings and list items as invisible Bitty comments", () => {
    const source = "# <!-- bitty-folded --> 标题\n\n正文\n\n- <!-- bitty-folded --> 父项\n  - 子项\n";
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      expect(parsed.doc.firstChild?.attrs.collapsed).toBe(true);
      expect(parsed.doc.lastChild?.firstChild?.attrs.collapsed).toBe(true);
      const saved = serializeMarkdown(parsed.doc);
      expect(saved.match(/<!-- bitty-folded -->/g)).toHaveLength(2);
      const reopened = parseMarkdown(saved);
      expect(reopened.mode).toBe("wysiwyg");
      if (reopened.mode === "wysiwyg") {
        expect(reopened.doc.firstChild?.textContent).toBe("标题");
        expect(reopened.doc.firstChild?.attrs.collapsed).toBe(true);
        expect(reopened.doc.lastChild?.firstChild?.attrs.collapsed).toBe(true);
      }
    }
  });

  it("drops a folded marker when its owner has no child content", () => {
    const parsed = parseMarkdown("# <!-- bitty-folded --> 空标题\n");
    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      expect(parsed.doc.firstChild?.attrs.collapsed).toBe(false);
      expect(serializeMarkdown(parsed.doc)).toBe("# 空标题\n");
    }
  });

  it.each([
    "## 二级标题\n",
    "[链接](https://example.com)\n",
    "![图片](image.png)\n",
    "`行内代码`\n",
    "```text\ncode\n```\n",
    "> 引用\n",
    "---\n",
    "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
    "<kbd>字体</kbd> &amp;\n",
  ])("keeps other syntax as ordinary paragraph text: %s", (source) => {
    const parsed = parseMarkdown(source);
    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      expect(parsed.doc.firstChild?.type.name).toBe("paragraph");
      expect(serializeMarkdown(parsed.doc)).toBe(source);
      const reopened = parseMarkdown(serializeMarkdown(parsed.doc));
      if (reopened.mode === "raw") throw new Error(reopened.reason);
      expect(reopened.doc.eq(parsed.doc)).toBe(true);
    }
  });

  it("renders supported blocks around literal link syntax", () => {
    const source = "# 标题\n\n[链接](https://example.com)\n\n- 第一项\n- 第二项\n";
    const parsed = parseMarkdown(source);

    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(Array.from({ length: parsed.doc.childCount }, (_, index) =>
      parsed.doc.child(index).type.name,
    )).toEqual(["heading", "paragraph", "bullet_list"]);
    expect(serializeMarkdown(parsed.doc)).toBe(source);
  });

  it("keeps task lists and highlights around literal HTML after saving and reopening", () => {
    const source = "# 清单\n\n- 目前\n    - [ ] =={blue}<kbd>字体==\n    - [x] **已完成** [链接](https://example.com)\n";
    const parsed = parseMarkdown(source);
    if (parsed.mode === "raw") throw new Error(parsed.reason);

    const saved = serializeMarkdown(parsed.doc);
    const reopened = parseMarkdown(saved);
    if (reopened.mode === "raw") throw new Error(reopened.reason);
    expect(saved).toBe(source);
    expect(reopened.doc.eq(parsed.doc)).toBe(true);
    const items: boolean[] = [];
    const highlighted: string[] = [];
    reopened.doc.descendants((node) => {
      expect(node.type.name).not.toBe("raw_block");
      if (typeof node.attrs.checked === "boolean") items.push(node.attrs.checked);
      if (noteSchema.marks.highlight.isInSet(node.marks)) highlighted.push(node.textContent);
    });
    expect(items).toEqual([false, true]);
    expect(highlighted).toEqual(["<kbd>字体"]);
  });

  it("preserves ordinary line breaks and spacing inside paragraphs and lists", () => {
    const source = "第一行  内容\n第二行\n\n- 项目\n  续行\n";
    const parsed = parseMarkdown(source);
    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(parsed.doc.firstChild?.child(1).type.name).toBe("hard_break");
    const saved = serializeMarkdown(parsed.doc);
    const reopened = parseMarkdown(saved);
    if (reopened.mode === "raw") throw new Error(reopened.reason);
    expect(saved).toContain("第一行  内容\n第二行");
    expect(reopened.doc.eq(parsed.doc)).toBe(true);
  });

  it("keeps escaped supported syntax literal after reopening", () => {
    const parsed = parseMarkdown("\\*\\*文字\\*\\* \\==高亮== \\<!-- 显示原文 -->\n");
    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(parsed.doc.textContent).toBe("**文字** ==高亮== <!-- 显示原文 -->");
    const reopened = parseMarkdown(serializeMarkdown(parsed.doc));
    if (reopened.mode === "raw") throw new Error(reopened.reason);
    expect(reopened.doc.eq(parsed.doc)).toBe(true);
  });

  it("hides comments while preserving their source, including multiline inline comments", () => {
    const source = "<!-- 独立\n\n注释 -->\n\n正文<!-- **隐藏**\n\n- [ ] 注释 -->尾部\n\n- [ ] 任务<!-- 行内注释 -->\n";
    const parsed = parseMarkdown(source);
    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(parsed.doc.textContent).toBe("正文尾部任务");
    const container = document.createElement("div");
    container.append(DOMSerializer.fromSchema(noteSchema).serializeFragment(parsed.doc.content));
    const comments = container.querySelectorAll("[data-html-comment]");
    expect(comments).toHaveLength(3);
    expect(Array.from(comments).every((element) => element.hasAttribute("hidden"))).toBe(true);
    const saved = serializeMarkdown(parsed.doc);
    expect(saved).toBe(source);
    const reopened = parseMarkdown(saved);
    if (reopened.mode === "raw") throw new Error(reopened.reason);
    expect(reopened.doc.eq(parsed.doc)).toBe(true);
  });

  it("preserves incomplete and escaped comments as ordinary text", () => {
    for (const source of ["<!-- 没有结束\n", "\\<!-- 注释 -->\n", "\\\\<!-- 注释 -->尾部\n"]) {
      const parsed = parseMarkdown(source);
      if (parsed.mode === "raw") throw new Error(parsed.reason);
      const reopened = parseMarkdown(serializeMarkdown(parsed.doc));
      if (reopened.mode === "raw") throw new Error(reopened.reason);
      expect(reopened.doc.eq(parsed.doc)).toBe(true);
    }
  });

  it("keeps comment-only documents editable without replacing the comment", () => {
    const parsed = parseMarkdown("<!-- 隐藏注释 -->\n");
    if (parsed.mode === "raw") throw new Error(parsed.reason);
    const state = EditorState.create({ doc: parsed.doc });
    expect(state.selection.$from.parent.isTextblock).toBe(true);
    const typed = state.apply(state.tr.insertText("正文"));
    const saved = serializeMarkdown(typed.doc);
    expect(saved).toBe("<!-- 隐藏注释 -->\n\n正文\n");
    const reopened = parseMarkdown(saved);
    if (reopened.mode === "raw") throw new Error(reopened.reason);
    expect(reopened.doc.eq(typed.doc)).toBe(true);
  });

  it("preserves marker examples inside a comment before interpreting metadata", () => {
    const source = "<!-- 示例\n# <!-- bitty-folded -->\n\n正文\n";
    const parsed = parseMarkdown(source);
    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(parsed.doc.textContent).toBe("正文");
    expect(serializeMarkdown(parsed.doc)).toBe(source);
  });

  it("treats inline and escaped empty-line markers as ordinary comments or text", () => {
    const source = "正文<!-- bitty-empty-line -->尾部\n\n\\<!-- bitty-empty-line -->\n";
    const parsed = parseMarkdown(source);
    if (parsed.mode === "raw") throw new Error(parsed.reason);
    expect(parsed.doc.textContent).toBe("正文尾部<!-- bitty-empty-line -->");
    expect(serializeMarkdown(parsed.doc)).toBe(source);
    const reopened = parseMarkdown(serializeMarkdown(parsed.doc));
    if (reopened.mode === "raw") throw new Error(reopened.reason);
    expect(reopened.doc.eq(parsed.doc)).toBe(true);
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
