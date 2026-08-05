import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import { moveRow } from "./row-drag";
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

  it("keeps a heading intact and splits an ordered list around it", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      heading("标题"),
      orderedList([item("有序一"), item("有序二"), item("有序三")]),
    ]);

    const next = moved(doc, "标题", "有序一");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).type.name,
    )).toEqual(["ordered_list", "heading", "ordered_list"]);
    expect(next.doc.child(0).textContent).toBe("有序一");
    expect(next.doc.child(1).textContent).toBe("标题");
    expect(next.doc.child(2).textContent).toBe("有序二有序三");
    expect(next.doc.child(0).attrs.order).toBe(1);
    expect(next.doc.child(2).attrs.order).toBe(1);
  });

  it("does not absorb a heading into the preceding list", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      heading("标题"),
      orderedList([item("有序一"), item("有序二")]),
      paragraph("正文"),
    ]);

    const next = moved(doc, "标题", "正文", "before");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).type.name,
    )).toEqual(["ordered_list", "heading", "paragraph"]);
    expect(next.doc.child(1).textContent).toBe("标题");
  });

  it("keeps a heading outside a nested list", () => {
    const doc = noteSchema.nodes.doc.create(null, [
      heading("标题"),
      orderedList([
        item("父项", null, [bulletList([item("子项")])]),
        item("同级项"),
      ]),
    ]);

    const next = moved(doc, "标题", "子项");

    expect(Array.from({ length: next.doc.childCount }, (_, index) =>
      next.doc.child(index).type.name,
    )).toEqual(["ordered_list", "heading"]);
    expect(next.doc.firstChild?.textContent).toBe("父项子项同级项");
    expect(next.doc.lastChild?.textContent).toBe("标题");
  });
});
