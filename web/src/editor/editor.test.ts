import { AllSelection, EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import {
  createEditor,
  exitEmptyListItem,
  joinEmptyParagraphAfterList,
  sinkListItemAcrossTypes,
  type ListKind,
  toggleList,
} from "./editor";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { noteSchema } from "./schema";

describe("task checkbox rendering", () => {
  it("removes the checked styling when a task is unchecked", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "- [x] 待办\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });

    const checkbox = host.querySelector<HTMLInputElement>("[data-task-checkbox]")!;
    expect(checkbox.checked).toBe(true);
    expect(host.querySelector(".task-list-item")?.classList.contains("is-checked")).toBe(true);

    checkbox.click();
    expect(checkbox.checked).toBe(false);
    expect(host.querySelector(".task-list-item")?.classList.contains("is-checked")).toBe(false);

    controller.destroy();
    host.remove();
  });
});

function listState(text = ""): EditorState {
  const paragraph = noteSchema.nodes.paragraph.create(
    null,
    text ? noteSchema.text(text) : undefined,
  );
  const item = noteSchema.nodes.list_item.create(null, paragraph);
  const list = noteSchema.nodes.bullet_list.create(null, item);
  const doc = noteSchema.nodes.doc.create(null, list);
  let paragraphPosition = -1;
  doc.descendants((node, position) => {
    if (node.type === noteSchema.nodes.paragraph) paragraphPosition = position;
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, paragraphPosition + 1),
  });
}

function emptyParagraphAfterListState(): EditorState {
  const listParagraph = noteSchema.nodes.paragraph.create(null, noteSchema.text("上一项"));
  const item = noteSchema.nodes.list_item.create(null, listParagraph);
  const list = noteSchema.nodes.bullet_list.create(null, item);
  const emptyParagraph = noteSchema.nodes.paragraph.create();
  const doc = noteSchema.nodes.doc.create(null, [list, emptyParagraph]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, list.nodeSize + 1),
  });
}

function selectedParagraphsState(): EditorState {
  const doc = noteSchema.nodes.doc.create(
    null,
    ["第一行", "第二行", "第三行"].map((text) =>
      noteSchema.nodes.paragraph.create(null, noteSchema.text(text)),
    ),
  );
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1, doc.content.size - 1),
  });
}

function mixedListState(
  first: ListKind,
  second: ListKind,
  separated = false,
): EditorState {
  const createList = (kind: ListKind, text: string) => {
    const paragraph = noteSchema.nodes.paragraph.create(null, noteSchema.text(text));
    const item = noteSchema.nodes.list_item.create(
      { checked: kind === "task" ? false : null },
      paragraph,
    );
    return (kind === "ordered"
      ? noteSchema.nodes.ordered_list
      : noteSchema.nodes.bullet_list).create(null, item);
  };
  const blocks = [createList(first, "第一项")];
  if (separated) blocks.push(noteSchema.nodes.paragraph.create());
  blocks.push(createList(second, "第二项"));
  const doc = noteSchema.nodes.doc.create(null, blocks);
  const paragraphs: number[] = [];
  doc.descendants((node, position) => {
    if (node.type === noteSchema.nodes.paragraph) paragraphs.push(position);
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(
      doc,
      paragraphs[0]! + 1,
      paragraphs[paragraphs.length - 1]! + 1
        + doc.nodeAt(paragraphs[paragraphs.length - 1]!)!.content.size,
    ),
  });
}

function partiallySelectedMixedListsState(): EditorState {
  const createItem = (text: string, checked: boolean | null) =>
    noteSchema.nodes.list_item.create(
      { checked },
      noteSchema.nodes.paragraph.create(null, noteSchema.text(text)),
    );
  const ordered = noteSchema.nodes.ordered_list.create(
    { order: 1 },
    ["有序一", "有序二", "有序三"].map((text) => createItem(text, null)),
  );
  const tasks = noteSchema.nodes.bullet_list.create(
    null,
    ["任务一", "任务二"].map((text) => createItem(text, false)),
  );
  const doc = noteSchema.nodes.doc.create(null, [ordered, tasks]);
  const paragraphs: Array<{ position: number; text: string }> = [];
  doc.descendants((node, position) => {
    if (node.type === noteSchema.nodes.paragraph) {
      paragraphs.push({ position, text: node.textContent });
    }
  });
  const from = paragraphs.find((paragraph) => paragraph.text === "有序三")!;
  const to = paragraphs.find((paragraph) => paragraph.text === "任务一")!;
  return EditorState.create({
    doc,
    selection: TextSelection.create(
      doc,
      from.position + 1,
      to.position + 1 + to.text.length,
    ),
  });
}

function nestedListState(): EditorState {
  const childParagraph = noteSchema.nodes.paragraph.create(null, noteSchema.text("子项"));
  const childItem = noteSchema.nodes.list_item.create({ checked: null }, childParagraph);
  const childList = noteSchema.nodes.bullet_list.create(null, childItem);
  const parentParagraph = noteSchema.nodes.paragraph.create(null, noteSchema.text("父项"));
  const parentItem = noteSchema.nodes.list_item.create(
    { checked: null },
    [parentParagraph, childList],
  );
  const parentList = noteSchema.nodes.ordered_list.create({ order: 1 }, parentItem);
  const doc = noteSchema.nodes.doc.create(null, parentList);
  let childPosition = -1;
  doc.descendants((node, position) => {
    if (node.type === noteSchema.nodes.paragraph && node.textContent === "子项") {
      childPosition = position;
    }
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, childPosition + 1),
  });
}

function adjacentDifferentListState(): EditorState {
  const createItem = (text: string, checked: boolean | null = null) =>
    noteSchema.nodes.list_item.create(
      { checked },
      noteSchema.nodes.paragraph.create(null, noteSchema.text(text)),
    );
  const ordered = noteSchema.nodes.ordered_list.create({ order: 1 }, createItem("父项"));
  const bullet = noteSchema.nodes.bullet_list.create(null, createItem("子项"));
  const doc = noteSchema.nodes.doc.create(null, [ordered, bullet]);
  let childPosition = -1;
  doc.descendants((node, position) => {
    if (node.type === noteSchema.nodes.paragraph && node.textContent === "子项") {
      childPosition = position;
    }
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, childPosition + 1),
  });
}

describe("list keyboard behavior", () => {
  it("lifts an empty list item when Backspace is pressed", () => {
    const state = listState();
    let next = state;

    expect(exitEmptyListItem(state, (transaction) => {
      next = state.apply(transaction);
    })).toBe(true);
    expect(next.doc.firstChild?.type).toBe(noteSchema.nodes.paragraph);
  });

  it("leaves a non-empty list item to the normal Backspace behavior", () => {
    expect(exitEmptyListItem(listState("内容"))).toBe(false);
  });

  it("returns to the previous list item from the empty paragraph after a list", () => {
    const state = emptyParagraphAfterListState();
    let next = state;

    expect(joinEmptyParagraphAfterList(state, (transaction) => {
      next = state.apply(transaction);
    })).toBe(true);
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild?.type).toBe(noteSchema.nodes.bullet_list);
    expect(next.selection.$from.parent.textContent).toBe("上一项");
    expect(next.selection.$from.parentOffset).toBe(3);
  });
});

describe("nested list types", () => {
  it("indents a different list type below the preceding item", () => {
    const state = adjacentDifferentListState();
    let indented = state;

    expect(sinkListItemAcrossTypes(state, (transaction) => {
      indented = state.apply(transaction);
    })).toBe(true);

    expect(indented.doc.childCount).toBe(1);
    expect(indented.doc.firstChild?.type).toBe(noteSchema.nodes.ordered_list);
    expect(indented.doc.firstChild?.firstChild?.lastChild?.type)
      .toBe(noteSchema.nodes.bullet_list);
    expect(indented.doc.textContent).toBe("父项子项");
  });

  it("changes only the nested list type", () => {
    const state = nestedListState();
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "task")).toBe(true);

    const outer = converted.doc.firstChild!;
    const inner = outer.firstChild!.lastChild!;
    expect(outer.type).toBe(noteSchema.nodes.ordered_list);
    expect(inner.type).toBe(noteSchema.nodes.bullet_list);
    expect(inner.firstChild?.attrs.checked).toBe(false);
  });

  it("round-trips mixed nested list types", () => {
    const source = "1. 父项\n\n    - [ ] 子项\n";
    const parsed = parseMarkdown(source);

    expect(parsed.mode).toBe("wysiwyg");
    if (parsed.mode === "wysiwyg") {
      expect(serializeMarkdown(parsed.doc)).toBe("1. 父项\n   - [ ] 子项\n");
      expect(parsed.doc.firstChild?.type).toBe(noteSchema.nodes.ordered_list);
      expect(parsed.doc.firstChild?.firstChild?.lastChild?.type)
        .toBe(noteSchema.nodes.bullet_list);
    }
  });
});

describe("multi-line list toggling", () => {
  it("converts an ordered item and a task item into one task list", () => {
    const state = mixedListState("ordered", "task");
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "task")).toBe(true);
    expect(converted.doc.childCount).toBe(1);
    expect(converted.doc.firstChild?.type).toBe(noteSchema.nodes.bullet_list);
    expect(converted.doc.firstChild?.childCount).toBe(2);
    expect(Array.from({ length: 2 }, (_, index) =>
      converted.doc.firstChild?.child(index).attrs.checked,
    )).toEqual([false, false]);
  });

  it.each([
    ["ordered", "task", "bullet", "bullet_list"],
    ["task", "bullet", "ordered", "ordered_list"],
    ["bullet", "ordered", "task", "bullet_list"],
  ] as const)(
    "converts a %s list and a %s list into one %s list",
    (first, second, target, nodeName) => {
      const state = mixedListState(first, second);
      let converted = state;

      expect(toggleList(state, (transaction) => {
        converted = state.apply(transaction);
      }, target)).toBe(true);
      expect(converted.doc.childCount).toBe(1);
      expect(converted.doc.firstChild?.type.name).toBe(nodeName);
      expect(converted.doc.firstChild?.childCount).toBe(2);
      expect(Array.from({ length: 2 }, (_, index) =>
        converted.doc.firstChild?.child(index).attrs.checked,
      )).toEqual(target === "task" ? [false, false] : [null, null]);
    },
  );

  it("keeps a blank line as the boundary between ordered-list sequences", () => {
    const state = mixedListState("bullet", "task", true);
    let converted = state;

    toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "ordered");

    expect(Array.from({ length: converted.doc.childCount }, (_, index) =>
      converted.doc.child(index).type.name,
    )).toEqual(["ordered_list", "paragraph", "ordered_list"]);
    const saved = serializeMarkdown(converted.doc);
    expect(saved).toContain("1. 第一项\n\n\n\n1. 第二项");

    const reopened = parseMarkdown(saved);
    expect(reopened.mode).toBe("wysiwyg");
    if (reopened.mode === "wysiwyg") {
      expect(Array.from({ length: reopened.doc.childCount }, (_, index) =>
        reopened.doc.child(index).type.name,
      )).toEqual(["ordered_list", "paragraph", "ordered_list"]);
    }
  });

  it("only converts the selected items from longer mixed lists", () => {
    const state = partiallySelectedMixedListsState();
    let converted = state;

    toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "task");

    expect(converted.doc.childCount).toBe(2);
    expect(converted.doc.firstChild?.type).toBe(noteSchema.nodes.ordered_list);
    expect(converted.doc.firstChild?.childCount).toBe(2);
    expect(converted.doc.lastChild?.type).toBe(noteSchema.nodes.bullet_list);
    expect(converted.doc.lastChild?.childCount).toBe(3);
    expect(converted.doc.textContent).toBe("有序一有序二有序三任务一任务二");
    expect(serializeMarkdown(converted.doc)).toMatch(/1\. 有序一[\s\S]*2\. 有序二/);

    let restored = converted;
    toggleList(converted, (transaction) => {
      restored = converted.apply(transaction);
    }, "task");
    expect(Array.from({ length: restored.doc.childCount }, (_, index) =>
      restored.doc.child(index).type.name,
    )).toEqual(["ordered_list", "paragraph", "paragraph", "bullet_list"]);
    expect(restored.doc.lastChild?.textContent).toBe("任务二");
  });

  it.each([
    ["bullet", "bullet_list"],
    ["ordered", "ordered_list"],
    ["task", "bullet_list"],
  ] as const)("toggles all selected paragraphs as a %s list", (kind, nodeName) => {
    const state = selectedParagraphsState();
    let listed = state;

    expect(toggleList(state, (transaction) => {
      listed = state.apply(transaction);
    }, kind as ListKind)).toBe(true);
    expect(listed.doc.childCount).toBe(1);
    expect(listed.doc.firstChild?.type.name).toBe(nodeName);
    expect(listed.doc.firstChild?.childCount).toBe(3);
    expect(Array.from({ length: 3 }, (_, index) =>
      listed.doc.firstChild?.child(index).textContent,
    )).toEqual(["第一行", "第二行", "第三行"]);
    if (kind === "task") {
      expect(Array.from({ length: 3 }, (_, index) =>
        listed.doc.firstChild?.child(index).attrs.checked,
      )).toEqual([false, false, false]);
    }

    let plain = listed;
    expect(toggleList(listed, (transaction) => {
      plain = listed.apply(transaction);
    }, kind as ListKind)).toBe(true);
    expect(plain.doc.childCount).toBe(3);
    expect(Array.from({ length: 3 }, (_, index) => plain.doc.child(index).type.name))
      .toEqual(["paragraph", "paragraph", "paragraph"]);
  });

  it("cancels the whole list when the list node itself is selected", () => {
    const state = selectedParagraphsState();
    let listed = state;
    toggleList(state, (transaction) => {
      listed = state.apply(transaction);
    }, "bullet");
    const selectedList = EditorState.create({
      doc: listed.doc,
      selection: new AllSelection(listed.doc),
    });
    let plain = selectedList;

    expect(toggleList(selectedList, (transaction) => {
      plain = selectedList.apply(transaction);
    }, "bullet")).toBe(true);
    expect(Array.from({ length: plain.doc.childCount }, (_, index) =>
      plain.doc.child(index).type.name,
    )).toEqual(["paragraph", "paragraph", "paragraph"]);
  });
});
