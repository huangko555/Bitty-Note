import { AllSelection, EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";
import { EditorView } from "prosemirror-view";

import {
  createEditor,
  exitEmptyListItem,
  joinEmptyParagraphAfterList,
  sinkListItemAcrossTypes,
  type ListKind,
  toggleList,
} from "./editor";
import { listNormalizationPlugin } from "./list-normalization";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { noteSchema } from "./schema";

describe("task checkbox rendering", () => {
  it("leaves ordinary click positioning to ProseMirror", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const positionAtCoords = vi
      .spyOn(EditorView.prototype, "posAtCoords")
      .mockReturnValue({ pos: 10, inside: -1 });
    const { controller } = createEditor(host, "First line\n\nSecond line\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const root = host.querySelector<HTMLElement>(".ProseMirror")!;

    root.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      clientX: 32,
      clientY: 480,
    }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    root.dispatchEvent(click);

    expect(positionAtCoords).toHaveBeenCalledOnce();
    expect(positionAtCoords).toHaveBeenCalledWith({ left: 32, top: 480 });
    expect(click.defaultPrevented).toBe(false);

    positionAtCoords.mockRestore();
    controller.destroy();
    host.remove();
  });

  it("toggles a task without allowing its press to move focus", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const focusChanges: boolean[] = [];
    const { controller } = createEditor(host, "- [ ] 待办\n", {
      onChange: () => {},
      onFocusChange: (focused) => focusChanges.push(focused),
      onSelectionChange: () => {},
    });

    const checkbox = host.querySelector<HTMLInputElement>("[data-task-checkbox]")!;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    checkbox.dispatchEvent(press);
    checkbox.click();

    expect(press.defaultPrevented).toBe(true);
    expect(focusChanges).not.toContain(true);
    expect(controller.getMarkdown()).toContain("- [x] 待办");

    controller.destroy();
    host.remove();
  });

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

  it("updates spell checking without recreating the editor", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "Text\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    }, false);

    controller.setSpellcheck(true);

    expect(host.querySelector<HTMLElement>(".ProseMirror")?.spellcheck).toBe(true);

    controller.destroy();
    host.remove();
  });
});

describe("spell checking", () => {
  it("applies the preference to the editor", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "正文", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    }, true);

    expect(host.querySelector(".ProseMirror")?.getAttribute("spellcheck")).toBe("true");

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

function singleListState(checked: boolean | null, text: string): EditorState {
  const paragraph = noteSchema.nodes.paragraph.create(null, noteSchema.text(text));
  const item = noteSchema.nodes.list_item.create({ checked }, paragraph);
  const list = noteSchema.nodes.bullet_list.create(null, item);
  const doc = noteSchema.nodes.doc.create(null, list);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 3),
  });
}

function singleParagraphState(text: string): EditorState {
  const doc = noteSchema.nodes.doc.create(
    null,
    noteSchema.nodes.paragraph.create(null, noteSchema.text(text)),
  );
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1),
  });
}

function twoItemListState(kind: ListKind): EditorState {
  const items = ["第一项", "第二项"].map((text, index) =>
    noteSchema.nodes.list_item.create(
      { checked: kind === "task" ? index === 0 : null },
      noteSchema.nodes.paragraph.create(null, noteSchema.text(text)),
    ),
  );
  const list = (kind === "ordered"
    ? noteSchema.nodes.ordered_list
    : noteSchema.nodes.bullet_list).create(null, items);
  const doc = noteSchema.nodes.doc.create(null, list);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 3),
  });
}

function twoParagraphCursorState(): EditorState {
  const doc = noteSchema.nodes.doc.create(null, [
    noteSchema.nodes.paragraph.create(null, noteSchema.text("第一行")),
    noteSchema.nodes.paragraph.create(null, noteSchema.text("第二行")),
  ]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 3),
  });
}

function middleOrderedItemState(): EditorState {
  const items = ["第一项", "第二项", "第三项"].map((text) =>
    noteSchema.nodes.list_item.create(
      null,
      noteSchema.nodes.paragraph.create(null, noteSchema.text(text)),
    ),
  );
  const list = noteSchema.nodes.ordered_list.create({ order: 1 }, items);
  const doc = noteSchema.nodes.doc.create(null, list);
  const middleParagraphPosition = 1 + items[0]!.nodeSize + 1;
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, middleParagraphPosition + 1),
    plugins: [listNormalizationPlugin()],
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
  it("restarts numbering after another list type interrupts an ordered list", () => {
    const state = middleOrderedItemState();
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "bullet")).toBe(true);

    expect(Array.from({ length: converted.doc.childCount }, (_, index) =>
      converted.doc.child(index).type.name,
    )).toEqual(["ordered_list", "bullet_list", "ordered_list"]);
    expect(converted.doc.lastChild?.attrs.order).toBe(1);
  });

  it("toggles only the current paragraph without changing the next line", () => {
    const state = twoParagraphCursorState();
    let listed = state;

    expect(toggleList(state, (transaction) => {
      listed = state.apply(transaction);
    }, "bullet")).toBe(true);
    expect(Array.from({ length: listed.doc.childCount }, (_, index) =>
      listed.doc.child(index).type.name,
    )).toEqual(["bullet_list", "paragraph"]);

    let restored = listed;
    expect(toggleList(listed, (transaction) => {
      restored = listed.apply(transaction);
    }, "bullet")).toBe(true);
    expect(Array.from({ length: restored.doc.childCount }, (_, index) =>
      restored.doc.child(index).type.name,
    )).toEqual(["paragraph", "paragraph"]);
  });

  it.each([
    ["bullet", "ordered"],
    ["ordered", "task"],
    ["task", "bullet"],
  ] as const)("converts only the current %s item to %s", (source, target) => {
    const state = twoItemListState(source);
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, target)).toBe(true);

    expect(converted.doc.childCount).toBe(2);
    expect(converted.doc.child(0).childCount).toBe(1);
    expect(converted.doc.child(0).textContent).toContain("第一项");
    expect(converted.doc.child(1).childCount).toBe(1);
    expect(converted.doc.child(1).textContent).toBe("第二项");
    if (source === "task") {
      expect(converted.doc.child(1).firstChild?.attrs.checked).toBe(false);
    }
  });

  it("turns only the current task item back into text", () => {
    const state = twoItemListState("task");
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "task")).toBe(true);

    expect(converted.doc.childCount).toBe(2);
    expect(converted.doc.firstChild?.type).toBe(noteSchema.nodes.paragraph);
    expect(converted.doc.firstChild?.textContent).toBe("[✓] 第一项");
    expect(converted.doc.lastChild?.type).toBe(noteSchema.nodes.bullet_list);
    expect(converted.doc.lastChild?.firstChild?.attrs.checked).toBe(false);
  });

  it("keeps a checked marker when a task becomes a bullet item", () => {
    const state = singleListState(true, "done");
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "bullet")).toBe(true);

    expect(converted.doc.firstChild?.firstChild?.attrs.checked).toBe(null);
    expect(converted.doc.textContent).toBe("[✓] done");
  });

  it("does not add a marker when an unchecked task becomes a bullet item", () => {
    const state = singleListState(false, "todo");
    let converted = state;

    toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "bullet");

    expect(converted.doc.textContent).toBe("todo");
  });

  it("restores a checked task from a leading completion marker", () => {
    const state = singleListState(null, "   [✓] done");
    let converted = state;

    toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "task");

    expect(converted.doc.firstChild?.firstChild?.attrs.checked).toBe(true);
    expect(converted.doc.textContent).toBe("done");
  });

  it("restores a checked task when a marked paragraph becomes a task", () => {
    const state = singleParagraphState("  ✓ done");
    let converted = state;

    toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "task");

    expect(converted.doc.firstChild?.firstChild?.attrs.checked).toBe(true);
    expect(converted.doc.textContent).toBe("done");
  });

  it("keeps a checked marker when a task is toggled back to text", () => {
    const state = singleListState(true, "done");
    let converted = state;

    toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "task");

    expect(converted.doc.firstChild?.type).toBe(noteSchema.nodes.paragraph);
    expect(converted.doc.textContent).toBe("[✓] done");
  });

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
    expect(saved).toContain("1. 第一项\n\n<!-- bitty-empty-line -->\n\n1. 第二项");

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
