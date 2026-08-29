import { AllSelection, EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";
import { EditorView } from "prosemirror-view";

import {
  createEditor,
  exitEmptyListItem,
  handleWindowEditorHistoryShortcut,
  joinEmptyParagraphAfterList,
  liftListItemAtStart,
  sinkListItemAcrossTypes,
  type ListKind,
  toggleList,
} from "./editor";
import { listNormalizationPlugin } from "./list-normalization";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { deleteRow } from "./row-drag";
import { noteSchema } from "./schema";

describe("window-level editor history shortcuts", () => {
  it("undoes and redoes while the rich editor is unfocused", () => {
    const host = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(host, outside);
    const revealRequests: boolean[] = [];
    const { controller } = createEditor(host, "- [ ] 待办\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: (reveal) => revealRequests.push(reveal),
    });
    host.querySelector<HTMLInputElement>("[data-task-checkbox]")!.click();
    expect(revealRequests).toEqual([false]);
    revealRequests.length = 0;
    outside.focus();

    const undoEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "z",
    });
    outside.addEventListener("keydown", (event) => {
      handleWindowEditorHistoryShortcut(event, controller);
    });
    outside.dispatchEvent(undoEvent);
    expect(controller.getMarkdown()).toContain("- [ ] 待办");
    expect(undoEvent.defaultPrevented).toBe(true);
    expect(revealRequests).toEqual([false]);

    revealRequests.length = 0;
    const redoEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "y",
    });
    outside.dispatchEvent(redoEvent);
    expect(controller.getMarkdown()).toContain("- [x] 待办");
    expect(redoEvent.defaultPrevented).toBe(true);
    expect(revealRequests).toEqual([false]);

    controller.destroy();
    host.remove();
    outside.remove();
  });

  it("keeps history shortcuts with another editable control", () => {
    const host = document.createElement("div");
    const input = document.createElement("input");
    document.body.append(host, input);
    const { controller } = createEditor(host, "- [ ] 待办\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    host.querySelector<HTMLInputElement>("[data-task-checkbox]")!.click();
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "z",
    });
    input.addEventListener("keydown", (shortcut) => {
      handleWindowEditorHistoryShortcut(shortcut, controller);
    });
    input.dispatchEvent(event);

    expect(controller.getMarkdown()).toContain("- [x] 待办");
    expect(event.defaultPrevented).toBe(false);

    controller.destroy();
    host.remove();
    input.remove();
  });
});

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
    const revealRequests: boolean[] = [];
    const { controller } = createEditor(host, "- [ ] 待办\n", {
      onChange: () => {},
      onFocusChange: (focused) => focusChanges.push(focused),
      onSelectionChange: (reveal) => revealRequests.push(reveal),
    });

    const checkbox = host.querySelector<HTMLInputElement>("[data-task-checkbox]")!;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    checkbox.dispatchEvent(press);
    checkbox.click();

    expect(press.defaultPrevented).toBe(true);
    expect(focusChanges).not.toContain(true);
    expect(controller.getMarkdown()).toContain("- [x] 待办");
    expect(revealRequests).toEqual([false]);

    controller.destroy();
    host.remove();
  });

  it("reveals text edits but preserves the viewport for row deletion", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const revealRequests: boolean[] = [];
    const { controller } = createEditor(host, "开头\n\n删除行\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: (reveal) => revealRequests.push(reveal),
    });
    const view = (controller as unknown as { view: EditorView }).view;

    view.dispatch(view.state.tr.insertText("输入", 1).scrollIntoView());
    expect(revealRequests).toEqual([true]);

    revealRequests.length = 0;
    expect(controller.undo()).toBe(true);
    expect(revealRequests).toEqual([true]);

    revealRequests.length = 0;
    expect(controller.redo()).toBe(true);
    expect(revealRequests).toEqual([true]);

    revealRequests.length = 0;
    let deletedPosition = -1;
    view.state.doc.descendants((node, position) => {
      if (node.isTextblock && node.textContent === "删除行") deletedPosition = position;
    });
    expect(deleteRow(view.state, view.dispatch, deletedPosition)).toBe(true);
    expect(revealRequests).toEqual([false]);

    revealRequests.length = 0;
    expect(controller.undo()).toBe(true);
    expect(revealRequests).toEqual([false]);

    revealRequests.length = 0;
    expect(controller.undo()).toBe(true);
    expect(revealRequests).toEqual([true]);

    revealRequests.length = 0;
    expect(controller.redo()).toBe(true);
    expect(revealRequests).toEqual([true]);

    revealRequests.length = 0;
    expect(controller.redo()).toBe(true);
    expect(revealRequests).toEqual([false]);

    controller.destroy();
    host.remove();
  });

  it("keeps toolbar formatting at the current viewport", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const revealRequests: boolean[] = [];
    const { controller } = createEditor(host, "正文\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: (reveal) => revealRequests.push(reveal),
    });
    const view = (controller as unknown as { view: EditorView }).view;
    const dispatch = view.dispatch.bind(view);
    vi.spyOn(view, "dispatch").mockImplementation((transaction) => {
      dispatch(transaction);
      host.scrollTop = 0;
    });
    host.scrollTop = 420;

    controller.run("heading");

    expect(host.scrollTop).toBe(420);
    expect(revealRequests).not.toContain(true);

    revealRequests.length = 0;
    expect(controller.undo()).toBe(true);
    expect(revealRequests).toEqual([false]);

    revealRequests.length = 0;
    expect(controller.redo()).toBe(true);
    expect(revealRequests).toEqual([false]);
    controller.destroy();
    host.remove();
  });

  it("applies highlight formatting and saves double equals markers", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "高亮正文\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const view = (controller as unknown as { view: EditorView }).view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));

    controller.run("highlight");

    expect(controller.getMarkdown()).toBe("==高亮==正文\n");
    expect(controller.activeActions()).toContain("highlight");
    expect(host.querySelector("mark.text-highlight")?.textContent).toBe("高亮");
    controller.destroy();
    host.remove();
  });

  it("applies, reports, replaces, and removes named highlight colors", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "高亮正文\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const view = (controller as unknown as { view: EditorView }).view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));

    controller.applyHighlight("red");
    expect(controller.getMarkdown()).toBe("=={red}高亮==正文\n");
    expect(controller.highlightState()).toBe("red");
    expect(host.querySelector("mark.text-highlight")?.getAttribute("data-highlight-color"))
      .toBe("red");

    controller.applyHighlight("blue");
    expect(controller.getMarkdown()).toBe("=={blue}高亮==正文\n");
    expect(controller.highlightState()).toBe("blue");

    controller.toggleHighlight("yellow");
    expect(controller.getMarkdown()).toBe("高亮正文\n");
    expect(controller.highlightState()).toBeNull();
    controller.destroy();
    host.remove();
  });

  it("normalizes a mixed selection to the preferred highlight color", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "红色普通\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const view = (controller as unknown as { view: EditorView }).view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    controller.applyHighlight("red");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)));

    expect(controller.highlightState()).toBe("mixed");
    controller.toggleHighlight("yellow");

    expect(controller.getMarkdown()).toBe("=={yellow}红色普通==\n");
    expect(controller.highlightState()).toBe("yellow");
    controller.destroy();
    host.remove();
  });

  it("reopens overlapping highlight edits without exposing Markdown markers", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "前中后\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const view = (controller as unknown as { view: EditorView }).view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
    controller.applyHighlight("red");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 3)));
    controller.applyHighlight("blue");
    const saved = controller.getMarkdown();
    expect(saved).toBe("=={red}前===={blue}中===={red}后==\n");
    controller.destroy();
    host.remove();

    const reopenedHost = document.createElement("div");
    document.body.append(reopenedHost);
    const { controller: reopened } = createEditor(reopenedHost, saved, {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const segments = [...reopenedHost.querySelectorAll<HTMLElement>("mark.text-highlight")]
      .map((mark) => [mark.textContent, mark.dataset.highlightColor]);

    expect(reopenedHost.querySelector(".ProseMirror")?.textContent).toBe("前中后");
    expect(segments).toEqual([
      ["前", "red"],
      ["中", "blue"],
      ["后", "red"],
    ]);
    expect(reopened.getMarkdown()).toBe(saved);
    reopened.destroy();
    reopenedHost.remove();
  });

  it("reopens four sequentially nested highlight colors without marker pollution", () => {
    const text = "改变列表模式后光标会移到下一行（子列表？）";
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, `- [ ] ${text}\n`, {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const view = (controller as unknown as { view: EditorView }).view;
    let paragraphPosition = -1;
    view.state.doc.descendants((node, position) => {
      if (node.type === noteSchema.nodes.paragraph && node.textContent === text) {
        paragraphPosition = position;
      }
    });
    const textStart = paragraphPosition + 1;
    const apply = (from: number, to: number, color: "red" | "yellow" | "blue" | "green") => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(
        view.state.doc,
        textStart + from,
        textStart + to,
      )));
      controller.applyHighlight(color);
    };
    apply(1, 16, "red");
    apply(3, 13, "yellow");
    apply(4, 10, "blue");
    apply(6, 8, "green");
    const saved = controller.getMarkdown();
    expect(saved).toBe(
      "- [ ] 改=={red}变列===={yellow}表===={blue}模式====后光===={blue}标会===={yellow}移到下===={red}一行（==子列表？）\n",
    );
    controller.destroy();
    host.remove();

    const reopenedHost = document.createElement("div");
    document.body.append(reopenedHost);
    const { controller: reopened } = createEditor(reopenedHost, saved, {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const segments = [...reopenedHost.querySelectorAll<HTMLElement>("mark.text-highlight")]
      .map((mark) => [mark.textContent, mark.dataset.highlightColor]);

    expect(reopenedHost.querySelector(".ProseMirror")?.textContent).toBe(text);
    expect(segments).toEqual([
      ["变列", "red"],
      ["表", "yellow"],
      ["模式", "blue"],
      ["后光", "green"],
      ["标会", "blue"],
      ["移到下", "yellow"],
      ["一行（", "red"],
    ]);
    expect(reopened.getMarkdown()).toBe(saved);
    reopened.destroy();
    reopenedHost.remove();
  });

  it.each([" ", "。", ","])(
    "ends highlight input before inserting the delimiter %j",
    (delimiter) => {
      const host = document.createElement("div");
      document.body.append(host);
      const { controller } = createEditor(host, "", {
        onChange: () => {},
        onFocusChange: () => {},
        onSelectionChange: () => {},
      });
      const view = (controller as unknown as { view: EditorView }).view;
      controller.toggleHighlight("red");
      view.dispatch(view.state.tr.insertText("高亮"));
      const position = view.state.selection.from;

      const handled = view.someProp("handleTextInput", (handler) =>
        handler(view, position, position, delimiter, () =>
          view.state.tr.insertText(delimiter, position, position)));
      expect(handled).toBe(true);
      view.dispatch(view.state.tr.insertText("普通"));

      expect(controller.getMarkdown()).toBe(`=={red}高亮==${delimiter}普通\n`);
      expect(controller.highlightState()).toBeNull();
      controller.destroy();
      host.remove();
    },
  );

  it("preserves the viewport intent when folding is undone and redone", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const revealRequests: boolean[] = [];
    const { controller } = createEditor(host, "# 标题\n\n正文\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: (reveal) => revealRequests.push(reveal),
    });

    host.querySelector<HTMLButtonElement>(".fold-toggle")!.click();
    expect(revealRequests).toEqual([false]);

    revealRequests.length = 0;
    expect(controller.undo()).toBe(true);
    expect(revealRequests).toEqual([false]);

    revealRequests.length = 0;
    expect(controller.redo()).toBe(true);
    expect(revealRequests).toEqual([false]);

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

  it("keeps highlight color markers unchanged when a task is checked", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const markdown = "- [ ] =={red}红色===={blue}蓝色==\n";
    const { controller } = createEditor(host, markdown, {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });

    host.querySelector<HTMLInputElement>("[data-task-checkbox]")!.click();

    expect(controller.getMarkdown()).toBe("- [x] =={red}红色===={blue}蓝色==\n");
    expect(
      [...host.querySelectorAll<HTMLElement>("mark.text-highlight")]
        .map((mark) => mark.dataset.highlightColor),
    ).toEqual(["red", "blue"]);

    controller.destroy();
    host.remove();
  });

  it("keeps browser spell checking disabled in the rich editor", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "Text\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });

    expect(host.querySelector(".ProseMirror")?.getAttribute("spellcheck")).toBe("false");

    controller.destroy();
    host.remove();
  });

  it("handles a final blank tail press before native caret placement", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(
      host,
      "body\n\n<!-- bitty-empty-line -->\n",
      {
        onChange: () => {},
        onFocusChange: () => {},
        onSelectionChange: () => {},
      },
    );
    const view = (controller as unknown as { view: EditorView }).view;
    const zone = host.querySelector<HTMLElement>(
      ".document-end-zone.is-placeholder",
    )!;
    vi.spyOn(host, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 300, 180));
    vi.spyOn(zone, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(20, 80, 260, 22));
    const event = new MouseEvent("mousedown", {
      cancelable: true,
      clientX: 100,
      clientY: 90,
    });

    expect(controller.handleDocumentTailPress(event)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.selection.$from.parent.content.size).toBe(0);
    expect(document.activeElement).toBe(view.dom);
    controller.destroy();
    host.remove();
  });

  it("focuses a non-empty document end only below its insert button", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(host, "body\n", {
      onChange: () => {},
      onFocusChange: () => {},
      onSelectionChange: () => {},
    });
    const view = (controller as unknown as { view: EditorView }).view;
    const button = host.querySelector<HTMLElement>(
      ".row-insert-button.is-terminal",
    )!;
    vi.spyOn(host, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 300, 180));
    vi.spyOn(button, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(20, 80, 260, 22));
    const buttonEvent = new MouseEvent("mousedown", {
      cancelable: true,
      clientX: 100,
      clientY: 90,
    });
    const belowEvent = new MouseEvent("mousedown", {
      cancelable: true,
      clientX: 100,
      clientY: 120,
    });

    expect(controller.handleDocumentTailPress(buttonEvent)).toBe(false);
    expect(buttonEvent.defaultPrevented).toBe(false);
    expect(controller.handleDocumentTailPress(belowEvent)).toBe(true);
    expect(belowEvent.defaultPrevented).toBe(true);
    expect(view.state.selection.$from.parent.textContent).toBe("body");
    expect(view.state.selection.$from.parentOffset).toBe(4);
    expect(document.activeElement).toBe(view.dom);

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

function emptyParagraphBeforeTextState(): EditorState {
  const doc = noteSchema.nodes.doc.create(null, [
    noteSchema.nodes.paragraph.create(),
    noteSchema.nodes.paragraph.create(null, noteSchema.text("下一行")),
  ]);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1),
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

function nestedListWithFollowingItemState(): EditorState {
  const childParagraph = noteSchema.nodes.paragraph.create(null, noteSchema.text("子项"));
  const childItem = noteSchema.nodes.list_item.create({ checked: null }, childParagraph);
  const childList = noteSchema.nodes.bullet_list.create(null, childItem);
  const parentParagraph = noteSchema.nodes.paragraph.create(null, noteSchema.text("父项"));
  const parentItem = noteSchema.nodes.list_item.create(
    { checked: null },
    [parentParagraph, childList],
  );
  const followingItem = noteSchema.nodes.list_item.create(
    { checked: null },
    noteSchema.nodes.paragraph.create(null, noteSchema.text("后项")),
  );
  const list = noteSchema.nodes.ordered_list.create({ order: 1 }, [parentItem, followingItem]);
  const doc = noteSchema.nodes.doc.create(null, list);
  let childPosition = -1;
  doc.descendants((node, position) => {
    if (node.type === noteSchema.nodes.paragraph && node.textContent === "子项") {
      childPosition = position;
    }
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, childPosition + 2),
  });
}

function nestedSiblingItemsState(
  kind: ListKind,
  fromText = "子项一",
  fromOffset = 1,
  toText = fromText,
  toOffset = fromOffset,
): EditorState {
  const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
    null,
    noteSchema.text(text),
  );
  const checked = kind === "task" ? [true, false] : [null, null];
  const children = ["子项一", "子项二"].map((text, index) =>
    noteSchema.nodes.list_item.create(
      { checked: checked[index], collapsed: false },
      paragraph(text),
    ),
  );
  const childList = (kind === "ordered"
    ? noteSchema.nodes.ordered_list
    : noteSchema.nodes.bullet_list).create(
    kind === "ordered" ? { order: 1 } : undefined,
    children,
  );
  const parent = noteSchema.nodes.list_item.create(
    { checked: null, collapsed: false },
    [paragraph("父项"), childList],
  );
  const following = noteSchema.nodes.list_item.create(
    { checked: null, collapsed: false },
    paragraph("后项"),
  );
  const outer = noteSchema.nodes.ordered_list.create({ order: 1 }, [parent, following]);
  const doc = noteSchema.nodes.doc.create(null, outer);
  const positions = new Map<string, number>();
  doc.descendants((node, position) => {
    if (node.type === noteSchema.nodes.paragraph) positions.set(node.textContent, position);
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(
      doc,
      positions.get(fromText)! + 1 + fromOffset,
      positions.get(toText)! + 1 + toOffset,
    ),
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
  it("joins an unwrapped middle task back into the previous task", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { controller } = createEditor(
      host,
      "- [ ] 第一行\n- [ ] 第二行\n- [ ] 第三行\n",
      {
        onChange: () => {},
        onFocusChange: () => {},
        onSelectionChange: () => {},
      },
    );
    const view = (controller as unknown as { view: EditorView }).view;
    let middleParagraphPosition = -1;
    view.state.doc.descendants((node, position) => {
      if (
        middleParagraphPosition < 0
        && node.type === noteSchema.nodes.paragraph
        && node.textContent === "第二行"
      ) {
        middleParagraphPosition = position;
      }
    });
    view.dispatch(view.state.tr.setSelection(
      TextSelection.create(view.state.doc, middleParagraphPosition + 1),
    ));

    view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    }));
    view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    }));

    expect(controller.getMarkdown()).toBe("- [ ] 第一行第二行\n- [ ] 第三行\n");
    expect(view.state.selection.$from.parent.textContent).toBe("第一行第二行");
    expect(view.state.selection.$from.parentOffset).toBe(3);
    controller.destroy();
    host.remove();
  });

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

  it("removes list indentation from a non-empty item at its start", () => {
    const state = listState("内容");
    let next = state;

    expect(liftListItemAtStart(state, (transaction) => {
      next = state.apply(transaction);
    })).toBe(true);
    expect(next.doc.firstChild?.type).toBe(noteSchema.nodes.paragraph);
    expect(next.doc.firstChild?.textContent).toBe("内容");
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

  it("keeps the cursor in a nested item when a following sibling exists", () => {
    const state = nestedListWithFollowingItemState();
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "ordered")).toBe(true);

    expect(converted.selection.$from.parent.textContent).toBe("子项");
    expect(converted.selection.$from.parentOffset).toBe(1);
  });

  it("removes a nested task item without changing the following outer item", () => {
    const state = nestedSiblingItemsState("task");
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "task")).toBe(true);

    const outer = converted.doc.firstChild!;
    expect(outer.type).toBe(noteSchema.nodes.ordered_list);
    expect(outer.childCount).toBe(3);
    expect(outer.child(0).firstChild?.textContent).toBe("父项");
    expect(outer.child(1).firstChild?.textContent).toBe("[✓] 子项一");
    expect(outer.child(1).lastChild?.textContent).toBe("子项二");
    expect(outer.child(1).lastChild?.lastChild?.attrs.checked).toBe(false);
    expect(outer.child(2).firstChild?.textContent).toBe("后项");
    expect(converted.selection.$from.parent.textContent).toBe("[✓] 子项一");
    expect(converted.selection.$from.parentOffset).toBe(5);
  });

  it("changes only the current nested item type", () => {
    const state = nestedSiblingItemsState("bullet");
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "ordered")).toBe(true);

    const parent = converted.doc.firstChild!.firstChild!;
    expect(parent.childCount).toBe(3);
    expect(parent.child(1).type).toBe(noteSchema.nodes.ordered_list);
    expect(parent.child(1).textContent).toBe("子项一");
    expect(parent.child(2).type).toBe(noteSchema.nodes.bullet_list);
    expect(parent.child(2).textContent).toBe("子项二");
    expect(converted.selection.$from.parent.textContent).toBe("子项一");
    expect(converted.selection.$from.parentOffset).toBe(1);
  });

  it("changes a selected nested range without lifting its parent", () => {
    const state = nestedSiblingItemsState("bullet", "子项一", 0, "子项二", 3);
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "ordered")).toBe(true);

    const outer = converted.doc.firstChild!;
    const parent = outer.firstChild!;
    expect(outer.type).toBe(noteSchema.nodes.ordered_list);
    expect(outer.childCount).toBe(2);
    expect(parent.firstChild?.textContent).toBe("父项");
    expect(parent.lastChild?.type).toBe(noteSchema.nodes.ordered_list);
    expect(parent.lastChild?.childCount).toBe(2);
    expect(converted.selection.$from.parent.textContent).toBe("子项一");
    expect(converted.selection.$to.parent.textContent).toBe("子项二");
  });

  it("keeps the caret beside task text when adding a completion prefix", () => {
    const state = nestedSiblingItemsState("task", "子项一", 2);
    let converted = state;

    expect(toggleList(state, (transaction) => {
      converted = state.apply(transaction);
    }, "ordered")).toBe(true);

    expect(converted.selection.$from.parent.textContent).toBe("[✓] 子项一");
    expect(converted.selection.$from.parentOffset).toBe(6);
  });

  it("indents across different list types at a nested level", () => {
    const paragraph = (text: string) => noteSchema.nodes.paragraph.create(
      null,
      noteSchema.text(text),
    );
    const item = (text: string) => noteSchema.nodes.list_item.create(
      { checked: null, collapsed: false },
      paragraph(text),
    );
    const previous = noteSchema.nodes.bullet_list.create(null, item("前项"));
    const current = noteSchema.nodes.ordered_list.create({ order: 1 }, item("当前项"));
    const parent = noteSchema.nodes.list_item.create(
      { checked: null, collapsed: false },
      [paragraph("父项"), previous, current],
    );
    const doc = noteSchema.nodes.doc.create(
      null,
      noteSchema.nodes.bullet_list.create(null, parent),
    );
    let currentPosition = -1;
    doc.descendants((node, position) => {
      if (node.type === noteSchema.nodes.paragraph && node.textContent === "当前项") {
        currentPosition = position;
      }
    });
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, currentPosition + 1),
    });
    let indented = state;

    expect(sinkListItemAcrossTypes(state, (transaction) => {
      indented = state.apply(transaction);
    })).toBe(true);

    const nextParent = indented.doc.firstChild!.firstChild!;
    expect(nextParent.childCount).toBe(2);
    expect(nextParent.lastChild?.type).toBe(noteSchema.nodes.bullet_list);
    expect(nextParent.lastChild?.firstChild?.lastChild?.type)
      .toBe(noteSchema.nodes.ordered_list);
    expect(nextParent.lastChild?.firstChild?.lastChild?.textContent).toBe("当前项");
    expect(indented.selection.$from.parent.textContent).toBe("当前项");
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
  it("keeps the cursor in an empty line when turning it into a task", () => {
    const state = emptyParagraphBeforeTextState();
    let listed = state;

    expect(toggleList(state, (transaction) => {
      listed = state.apply(transaction);
    }, "task")).toBe(true);

    const { $from } = listed.selection;
    expect(Array.from({ length: $from.depth + 1 }, (_, depth) => $from.node(depth).type))
      .toContain(noteSchema.nodes.list_item);
    expect(listed.doc.lastChild?.textContent).toBe("下一行");
  });

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
