import { history, redo, undo } from "prosemirror-history";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import { deleteRow, moveRow } from "./row-drag";
import { noteSchema } from "./schema";

function paragraph(text: string) {
  return noteSchema.nodes.paragraph.create(null, text ? noteSchema.text(text) : undefined);
}

function heading(text: string) {
  return noteSchema.nodes.heading.create({ level: 1 }, noteSchema.text(text));
}

function item(
  text: string,
  checked: boolean | null = null,
  children: readonly ReturnType<typeof noteSchema.nodes.bullet_list.create>[] = [],
) {
  return noteSchema.nodes.list_item.create({ checked }, [paragraph(text), ...children]);
}

function bulletList(items: readonly ReturnType<typeof item>[]) {
  return noteSchema.nodes.bullet_list.create(null, items);
}

function orderedList(items: readonly ReturnType<typeof item>[]) {
  return noteSchema.nodes.ordered_list.create({ order: 1 }, items);
}

function rowPosition(doc: EditorState["doc"], text: string): number {
  let found = -1;
  doc.descendants((node, position) => {
    if (
      found < 0
      && ((node.type === noteSchema.nodes.list_item && node.firstChild?.textContent === text)
        || ((node.type === noteSchema.nodes.paragraph || node.type === noteSchema.nodes.heading)
          && node.textContent === text
          && doc.resolve(position).depth === 0))
    ) {
      found = position;
      return false;
    }
    return found < 0;
  });
  if (found < 0) throw new Error(`Row not found: ${text}`);
  return found;
}

function moved(
  doc: EditorState["doc"],
  source: string,
  target: string,
  side: "before" | "after" = "after",
): EditorState {
  const state = EditorState.create({ doc });
  let next = state;
  expect(moveRow(
    state,
    (transaction) => {
      next = state.apply(transaction);
    },
    rowPosition(doc, source),
    rowPosition(doc, target),
    side,
  )).toBe(true);
  return next;
}

describe("row dragging", () => {
  it("deletes a row through history so it can be undone and redone", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph("甲"),
      paragraph("乙"),
      paragraph("丙"),
    ]);
    let state = EditorState.create({ doc, plugins: [history()] });
    let scrolledIntoView = false;
    const dispatch = (transaction: Transaction) => {
      scrolledIntoView = transaction.scrolledIntoView;
      state = state.apply(transaction);
    };

    expect(deleteRow(state, dispatch, rowPosition(doc, "乙"))).toBe(true);
    expect(scrolledIntoView).toBe(false);
    expect(state.doc.textContent).toBe("甲丙");
    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.textContent).toBe("甲乙丙");
    expect(redo(state, dispatch)).toBe(true);
    expect(state.doc.textContent).toBe("甲丙");
  });

  it("keeps an editable empty paragraph after deleting the only row", () => {
    const doc = noteSchema.nodes.doc.create(null, paragraph("唯一一行"));
    const state = EditorState.create({ doc });
    let next = state;

    expect(deleteRow(state, (transaction) => {
      next = state.apply(transaction);
    }, rowPosition(doc, "唯一一行"))).toBe(true);

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild?.type).toBe(noteSchema.nodes.paragraph);
    expect(next.doc.firstChild?.textContent).toBe("");
  });

  it("deletes one list item without removing its remaining siblings", () => {
    const doc = noteSchema.nodes.doc.create(null, bulletList([
      item("保留"),
      item("删除"),
    ]));
    const state = EditorState.create({ doc });
    let next = state;

    expect(deleteRow(state, (transaction) => {
      next = state.apply(transaction);
    }, rowPosition(doc, "删除"))).toBe(true);

    expect(next.doc.firstChild?.type).toBe(noteSchema.nodes.bullet_list);
    expect(next.doc.firstChild?.childCount).toBe(1);
    expect(next.doc.textContent).toBe("保留");
  });

  it("deletes a heading together with its section and keeps the next section", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      heading("删除标题"),
      paragraph("删除正文"),
      bulletList([item("删除列表", false)]),
      heading("保留标题"),
      paragraph("保留正文"),
    ]);
    const state = EditorState.create({ doc });
    let next = state;

    expect(deleteRow(state, (transaction) => {
      next = state.apply(transaction);
    }, rowPosition(doc, "删除标题"))).toBe(true);

    expect(Array.from(next.doc.content.content, (node) => node.textContent))
      .toEqual(["保留标题", "保留正文"]);
  });

  it("does not steal an existing caret from an unrelated row", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph("甲"),
      paragraph("乙"),
      paragraph("丙"),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    let next = state;

    expect(moveRow(
      state,
      (transaction) => {
        next = state.apply(transaction);
      },
      rowPosition(doc, "乙"),
      rowPosition(doc, "丙"),
      "after",
    )).toBe(true);

    expect(next.selection.$from.parent.textContent).toBe("甲");
  });

  it("keeps the caret with a row when that row is moved", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph("甲"),
      paragraph("乙内容"),
      paragraph("丙"),
    ]);
    const sourcePosition = rowPosition(doc, "乙内容");
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, sourcePosition + 3),
    });
    let next = state;

    expect(moveRow(
      state,
      (transaction) => {
        next = state.apply(transaction);
      },
      sourcePosition,
      rowPosition(doc, "丙"),
      "after",
    )).toBe(true);

    expect(next.selection.$from.parent.textContent).toBe("乙内容");
    expect(next.selection.$from.parentOffset).toBe(2);
  });

  it("does not request scrolling to a stale caret after a row move", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph("甲"),
      paragraph("乙"),
      paragraph("丙"),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    let didDispatch = false;

    expect(moveRow(
      state,
      (transaction) => {
        didDispatch = true;
        expect(transaction.scrolledIntoView).toBe(false);
      },
      rowPosition(doc, "乙"),
      rowPosition(doc, "丙"),
      "after",
    )).toBe(true);

    expect(didDispatch).toBe(true);
  });

  it("reorders top-level paragraphs", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph("甲"),
      paragraph("乙"),
      paragraph("丙"),
    ]);

    const next = moved(doc, "甲", "丙");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).textContent,
    )).toEqual(["乙", "丙", "甲"]);
  });

  it("moves one ordered item with all descendants and leaves siblings alone", () => {
    const nested = bulletList([item("子项一"), item("子项二", true)]);
    const doc = noteSchema.nodes.doc.create(null, orderedList([
      item("父项", null, [nested]),
      item("同级一"),
      item("同级二"),
    ]));

    const next = moved(doc, "父项", "同级二");
    const list = next.doc.firstChild!;

    expect(Array.from({ length: list.childCount }, (_, index) =>
      list.child(index).firstChild?.textContent,
    )).toEqual(["同级一", "同级二", "父项"]);
    expect(list.lastChild?.lastChild?.eq(nested)).toBe(true);
    expect(list.lastChild?.lastChild?.lastChild?.attrs.checked).toBe(true);
  });

  it("converts a paragraph to the preceding task-list type", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph("正文"),
      bulletList([item("任务", false)]),
      paragraph("结尾"),
    ]);

    const next = moved(doc, "正文", "任务");
    const list = next.doc.firstChild!;

    expect(list.type).toBe(noteSchema.nodes.bullet_list);
    expect(list.childCount).toBe(2);
    expect(list.lastChild?.firstChild?.textContent).toBe("正文");
    expect(list.lastChild?.attrs.checked).toBe(false);
  });

  it.each([
    ["无序列表", bulletList([item("目标")])],
    ["有序列表", orderedList([item("目标")])],
    ["勾选框", bulletList([item("目标", false)])],
  ])("keeps an empty paragraph editable after moving it into %s", (_name, targetList) => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph(""),
      targetList,
      paragraph("结尾"),
    ]);

    const next = moved(doc, "", "目标");
    const movedItem = next.doc.firstChild?.lastChild;

    expect(() => next.doc.check()).not.toThrow();
    expect(movedItem?.firstChild?.type).toBe(noteSchema.nodes.paragraph);
    expect(movedItem?.firstChild?.textContent).toBe("");
  });

  it("keeps a list item as a list when moved after ordinary text", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      orderedList([item("有序一"), item("有序二")]),
      paragraph("正文"),
      paragraph("结尾"),
    ]);

    const next = moved(doc, "有序一", "正文");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).type.name,
    )).toEqual(["ordered_list", "paragraph", "ordered_list", "paragraph"]);
    expect(next.doc.child(0).textContent).toBe("有序二");
    expect(next.doc.child(2).textContent).toBe("有序一");
  });

  it("converts the parent type but preserves child-list properties", () => {
    const nestedTasks = bulletList([item("已完成子项", true)]);
    const doc = noteSchema.nodes.doc.create(null, [
      bulletList([item("已完成任务", true, [nestedTasks])]),
      orderedList([item("有序项")]),
    ]);

    const next = moved(doc, "已完成任务", "有序项");
    const list = next.doc.firstChild!;
    const movedItem = list.lastChild!;

    expect(list.type).toBe(noteSchema.nodes.ordered_list);
    expect(movedItem.attrs.checked).toBe(null);
    expect(movedItem.lastChild?.lastChild?.attrs.checked).toBe(true);
  });

  it("does not allow a parent to be dropped into its own descendants", () => {
    const doc = noteSchema.nodes.doc.create(null, orderedList([
      item("父项", null, [bulletList([item("子项")])]),
      item("同级项"),
    ]));
    const state = EditorState.create({ doc });

    expect(moveRow(
      state,
      undefined,
      rowPosition(doc, "父项"),
      rowPosition(doc, "子项"),
      "after",
    )).toBe(false);
  });

  it("can insert before the first item in a list", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph("正文"),
      orderedList([item("有序一"), item("有序二")]),
    ]);

    const next = moved(doc, "正文", "有序一", "before");

    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild?.type).toBe(noteSchema.nodes.ordered_list);
    expect(Array.from({ length: 3 }, (_, index) =>
      next.doc.firstChild?.child(index).firstChild?.textContent,
    )).toEqual(["正文", "有序一", "有序二"]);
  });

  it("merges newly adjacent ordered lists so numbering stays continuous", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      orderedList([item("有序一")]),
      paragraph("中间正文"),
      orderedList([item("有序二")]),
      paragraph("结尾"),
    ]);

    const next = moved(doc, "中间正文", "结尾");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).type.name,
    )).toEqual(["ordered_list", "paragraph", "paragraph"]);
    expect(next.doc.firstChild?.childCount).toBe(2);
    expect(next.doc.firstChild?.textContent).toBe("有序一有序二");
  });

  it("moves a complete heading section and splits an ordered list around it", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      orderedList([item("有序一"), item("有序二"), item("有序三")]),
      heading("标题"),
      paragraph("标题正文"),
      heading("保留章节"),
    ]);

    const next = moved(doc, "标题", "有序一");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).type.name,
    )).toEqual(["ordered_list", "heading", "paragraph", "ordered_list", "heading"]);
    expect(next.doc.child(0).textContent).toBe("有序一");
    expect(next.doc.child(1).textContent).toBe("标题");
    expect(next.doc.child(2).textContent).toBe("标题正文");
    expect(next.doc.child(3).textContent).toBe("有序二有序三");
    expect(next.doc.child(4).textContent).toBe("保留章节");
    expect(next.doc.child(0).attrs.order).toBe(1);
    expect(next.doc.child(3).attrs.order).toBe(1);
  });

  it("drops a heading after another heading's complete section", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      heading("移动标题"),
      paragraph("移动正文"),
      heading("目标标题"),
      paragraph("目标正文"),
      heading("末尾标题"),
    ]);

    const next = moved(doc, "移动标题", "目标标题", "after");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).textContent,
    )).toEqual(["目标标题", "目标正文", "移动标题", "移动正文", "末尾标题"]);
  });

  it("keeps a heading section outside a nested list", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      orderedList([
        item("父项", null, [bulletList([item("子项")])]),
        item("同级项"),
      ]),
      paragraph("前言正文"),
      heading("标题"),
      paragraph("标题正文"),
      heading("保留章节"),
    ]);

    const next = moved(doc, "标题", "子项");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).type.name,
    )).toEqual(["ordered_list", "heading", "paragraph", "paragraph", "heading"]);
    expect(next.doc.child(0).textContent).toBe("父项子项同级项");
    expect(next.doc.child(1).textContent).toBe("标题");
    expect(next.doc.child(2).textContent).toBe("标题正文");
    expect(next.doc.child(3).textContent).toBe("前言正文");
    expect(next.doc.child(4).textContent).toBe("保留章节");
  });

  it("does not allow a heading to be dropped into its own section", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      heading("标题"),
      paragraph("正文"),
      heading("其他标题"),
    ]);
    const state = EditorState.create({ doc });

    expect(moveRow(
      state,
      undefined,
      rowPosition(doc, "标题"),
      rowPosition(doc, "正文"),
      "after",
    )).toBe(false);
  });

  it("snaps a heading dropped within another section to that section's end", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      heading("移动标题"),
      paragraph("移动正文"),
      heading("目标标题"),
      paragraph("目标正文一"),
      paragraph("目标正文二"),
    ]);
    const next = moved(doc, "移动标题", "目标正文一", "before");

    expect(Array.from(next.doc.content.content, (node) => node.textContent))
      .toEqual(["目标标题", "目标正文一", "目标正文二", "移动标题", "移动正文"]);
  });

  it("allows a heading section to be inserted among unowned leading content", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      paragraph("前言一"),
      paragraph("前言二"),
      heading("移动标题"),
      paragraph("移动正文"),
      heading("保留标题"),
    ]);

    const next = moved(doc, "移动标题", "前言一", "after");

    expect(Array.from(next.doc.content.content, (node) => node.textContent))
      .toEqual(["前言一", "移动标题", "移动正文", "前言二", "保留标题"]);
  });
});
