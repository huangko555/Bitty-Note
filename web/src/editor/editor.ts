import { baseKeymap, chainCommands, setBlockType, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import { Fragment, type Node as ProseMirrorNode, Slice } from "prosemirror-model";
import {
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from "prosemirror-schema-list";
import { EditorState, Selection, TextSelection, type Transaction } from "prosemirror-state";
import { findWrapping } from "prosemirror-transform";
import { EditorView } from "prosemirror-view";

import { listNormalizationPlugin } from "./list-normalization";
import { parseMarkdown, parseSupportedFragment, serializeMarkdown } from "./markdown";
import { rowDragPlugin } from "./row-drag";
import { rowInsertPlugin } from "./row-insert";
import { noteSchema } from "./schema";
import { keepRectVisible } from "./selection-visibility";

export type EditorAction =
  | "heading"
  | "strong"
  | "em"
  | "strike"
  | "bullet"
  | "ordered"
  | "task";

export type ListKind = "bullet" | "ordered" | "task";

export interface EditorSnapshot {
  markdown: string;
  mode: "wysiwyg" | "raw";
  rawReason?: string;
}

export interface EditorController {
  readonly mode: "wysiwyg" | "raw";
  getMarkdown(): string;
  run(action: EditorAction): void;
  activeActions(): Set<EditorAction>;
  setSpellcheck(enabled: boolean): void;
  focus(): void;
  ensureSelectionVisible(bottomInset?: number): void;
  destroy(): void;
}

interface EditorCallbacks {
  onChange: (markdown: string) => void;
  onFocusChange: (focused: boolean) => void;
  onSelectionChange: () => void;
}

function markInputRule(pattern: RegExp, markName: "strong" | "em" | "strike"): InputRule {
  return new InputRule(pattern, (state, match, _start, end) => {
    const marked = match[1];
    const text = match[2];
    if (!marked || text === undefined) return null;
    const start = end - marked.length;
    return state.tr
      .insertText(text, start, end)
      .addMark(start, start + text.length, noteSchema.marks[markName].create());
  });
}

function taskInputRule(): InputRule {
  return new InputRule(/^- \[([ xX])\] $/, (state, match, start, end) => {
    const transaction = state.tr.delete(start, end);
    const $start = transaction.doc.resolve(start);
    const range = $start.blockRange();
    const wrapping = range && findWrapping(range, noteSchema.nodes.bullet_list);
    if (!range || !wrapping) return null;
    transaction.wrap(range, wrapping);
    const resolved = transaction.doc.resolve(start);
    for (let depth = resolved.depth; depth > 0; depth -= 1) {
      if (resolved.node(depth).type === noteSchema.nodes.list_item) {
        transaction.setNodeMarkup(resolved.before(depth), undefined, {
          checked: match[1]?.toLowerCase() === "x",
        });
        break;
      }
    }
    return transaction;
  });
}

function inputRulePlugin() {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^# $/, noteSchema.nodes.heading, { level: 1 }),
      taskInputRule(),
      wrappingInputRule(/^- $/, noteSchema.nodes.bullet_list),
      wrappingInputRule(/^(\d+)\. $/, noteSchema.nodes.ordered_list, (match) => ({
        order: Number(match[1] ?? 1),
      })),
      markInputRule(/(\*\*([^*]+)\*\*)$/, "strong"),
      markInputRule(/(~~([^~]+)~~)$/, "strike"),
      markInputRule(/(?:^|[^*])(\*([^*]+)\*)$/, "em"),
    ],
  });
}

function currentListItemChecked(state: EditorState): boolean | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === noteSchema.nodes.list_item) return node.attrs.checked;
  }
  return null;
}

function splitCurrentListItem(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const checked = currentListItemChecked(state);
  return splitListItem(noteSchema.nodes.list_item, {
    checked: typeof checked === "boolean" ? false : null,
  })(state, dispatch);
}

export function exitEmptyListItem(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from, empty } = state.selection;
  if (
    !empty
    || $from.parent.type !== noteSchema.nodes.paragraph
    || $from.parent.content.size !== 0
    || $from.parentOffset !== 0
  ) {
    return false;
  }
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    if ($from.node(depth).type === noteSchema.nodes.list_item) {
      return liftListItem(noteSchema.nodes.list_item)(state, dispatch);
    }
  }
  return false;
}

export function joinEmptyParagraphAfterList(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from, empty } = state.selection;
  if (
    !empty
    || $from.depth !== 1
    || $from.parent.type !== noteSchema.nodes.paragraph
    || $from.parent.content.size !== 0
    || $from.parentOffset !== 0
  ) {
    return false;
  }
  const paragraphStart = $from.before(1);
  const previous = state.doc.resolve(paragraphStart).nodeBefore;
  if (
    previous?.type !== noteSchema.nodes.bullet_list
    && previous?.type !== noteSchema.nodes.ordered_list
  ) {
    return false;
  }
  if (dispatch) {
    const transaction = state.tr.delete(paragraphStart, $from.after(1));
    transaction.setSelection(
      Selection.near(transaction.doc.resolve(paragraphStart), -1),
    );
    dispatch(transaction.scrollIntoView());
  }
  return true;
}

function literalTextSlice(text: string): Slice {
  const blocks = text.replace(/\r\n?/g, "\n").split("\n").map((line) =>
    noteSchema.nodes.paragraph.create(null, line ? noteSchema.text(line) : undefined),
  );
  return Slice.maxOpen(noteSchema.nodes.doc.create(null, blocks).content);
}

function restoreNativeSelection(view: EditorView, anchor: number, head: number): void {
  window.queueMicrotask(() => {
    if (!view.dom.isConnected) return;
    const selection = view.dom.ownerDocument.getSelection();
    if (!selection) return;
    try {
      const anchorPoint = view.domAtPos(anchor);
      const headPoint = view.domAtPos(head);
      selection.setBaseAndExtent(
        anchorPoint.node,
        anchorPoint.offset,
        headPoint.node,
        headPoint.offset,
      );
    } catch {
      // The document may have changed again before the queued restoration.
    }
  });
}

function nearestList(state: Pick<EditorState, "selection">) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === noteSchema.nodes.bullet_list || node.type === noteSchema.nodes.ordered_list) {
      return { node, position: $from.before(depth), depth };
    }
  }
  return null;
}

export function sinkListItemAcrossTypes(
  state: EditorState,
  dispatch?: (transaction: Transaction) => void,
): boolean {
  if (!state.selection.empty) return false;
  const current = nearestList(state);
  if (!current || current.depth !== 1 || state.selection.$from.index(current.depth) !== 0) {
    return false;
  }

  const previous = state.doc.resolve(current.position).nodeBefore;
  if (
    !previous
    || (previous.type !== noteSchema.nodes.bullet_list
      && previous.type !== noteSchema.nodes.ordered_list)
    || previous.type === current.node.type
  ) {
    return false;
  }
  if (!dispatch) return true;

  const item = current.node.firstChild!;
  const previousItem = previous.lastChild!;
  const nestedList = current.node.type.create(current.node.attrs, item);
  const extendedPreviousItem = previousItem.copy(
    previousItem.content.append(Fragment.from(nestedList)),
  );
  const extendedPrevious = previous.copy(
    previous.content.replaceChild(previous.childCount - 1, extendedPreviousItem),
  );
  const remainingContent = current.node.content.cut(item.nodeSize);
  const replacement = [extendedPrevious];
  if (remainingContent.size) {
    const remainingAttrs = current.node.type === noteSchema.nodes.ordered_list
      ? { ...current.node.attrs, order: Number(current.node.attrs.order) + 1 }
      : current.node.attrs;
    replacement.push(current.node.type.create(remainingAttrs, remainingContent));
  }

  const paragraph = state.selection.$from.parent;
  const paragraphOffset = state.selection.$from.parentOffset;
  const from = current.position - previous.nodeSize;
  const transaction = state.tr.replaceWith(
    from,
    current.position + current.node.nodeSize,
    replacement,
  );
  let paragraphPosition = -1;
  transaction.doc.descendants((node, position) => {
    if (node === paragraph) paragraphPosition = position;
  });
  if (paragraphPosition >= 0) {
    transaction.setSelection(TextSelection.create(
      transaction.doc,
      paragraphPosition + 1 + paragraphOffset,
    ));
  }
  dispatch(transaction.scrollIntoView());
  return true;
}

const COMPLETED_PREFIX = "[✓] ";
const COMPLETED_PREFIX_PATTERN = /^\s*(?:\[✓\]|✓)\s*/u;

function stripCompletedPrefix(content: Fragment): { content: Fragment; completed: boolean } {
  const paragraph = content.firstChild;
  if (!paragraph || paragraph.type !== noteSchema.nodes.paragraph) {
    return { content, completed: false };
  }
  const match = COMPLETED_PREFIX_PATTERN.exec(paragraph.textContent);
  if (!match) return { content, completed: false };

  const children: ProseMirrorNode[] = [paragraph.copy(paragraph.content.cut(match[0].length))];
  for (let index = 1; index < content.childCount; index += 1) {
    children.push(content.child(index));
  }
  return { content: Fragment.fromArray(children), completed: true };
}

function addCompletedPrefix(content: Fragment): Fragment {
  const stripped = stripCompletedPrefix(content).content;
  const paragraph = stripped.firstChild;
  if (!paragraph || paragraph.type !== noteSchema.nodes.paragraph) return stripped;

  const children: ProseMirrorNode[] = [paragraph.copy(
    Fragment.from(noteSchema.text(COMPLETED_PREFIX)).append(paragraph.content),
  )];
  for (let index = 1; index < stripped.childCount; index += 1) {
    children.push(stripped.child(index));
  }
  return Fragment.fromArray(children);
}

function convertedItemContent(
  content: Fragment,
  sourceChecked: boolean | null,
  kind: ListKind,
): { content: Fragment; checked: boolean | null } {
  if (kind !== "task") {
    return {
      content: sourceChecked === true ? addCompletedPrefix(content) : content,
      checked: null,
    };
  }
  if (typeof sourceChecked === "boolean") return { content, checked: sourceChecked };
  const stripped = stripCompletedPrefix(content);
  return { content: stripped.content, checked: stripped.completed };
}

function convertListNode(listNode: ProseMirrorNode, kind: ListKind): ProseMirrorNode {
  const items: ProseMirrorNode[] = [];
  listNode.forEach((item) => {
    const converted = convertedItemContent(item.content, item.attrs.checked, kind);
    items.push(noteSchema.nodes.list_item.create(
      { ...item.attrs, checked: converted.checked },
      converted.content,
    ));
  });
  const listType = kind === "ordered"
    ? noteSchema.nodes.ordered_list
    : noteSchema.nodes.bullet_list;
  return listType.create(kind === "ordered" ? { order: 1 } : undefined, items);
}

function listKind(state: EditorState): ListKind | null {
  const list = nearestList(state);
  if (!list) return null;
  if (list.node.type === noteSchema.nodes.ordered_list) return "ordered";
  return typeof currentListItemChecked(state) === "boolean" ? "task" : "bullet";
}

interface ListItemUnit {
  type: "list-item";
  item: ProseMirrorNode;
  kind: ListKind;
  order: number;
  selected: boolean;
}

interface BlockUnit {
  type: "block";
  node: ProseMirrorNode;
  selected: boolean;
}

type RebuildUnit = ListItemUnit | BlockUnit;

function selectionIntersects(
  selection: EditorState["selection"],
  from: number,
  to: number,
): boolean {
  return selection.empty
    ? selection.from >= from && selection.from <= to
    : selection.from < to && selection.to > from;
}

function selectedUnits(state: EditorState): RebuildUnit[] {
  const units: RebuildUnit[] = [];
  state.doc.forEach((node, position) => {
    if (node.type !== noteSchema.nodes.bullet_list && node.type !== noteSchema.nodes.ordered_list) {
      const convertible = (
        node.type === noteSchema.nodes.paragraph
        || node.type === noteSchema.nodes.heading
      ) && node.content.size > 0;
      units.push({
        type: "block",
        node,
        selected: convertible && selectionIntersects(
          state.selection,
          position,
          position + node.nodeSize,
        ),
      });
      return;
    }

    let offset = 0;
    node.forEach((item, _itemOffset, index) => {
      const itemPosition = position + 1 + offset;
      const kind: ListKind = node.type === noteSchema.nodes.ordered_list
        ? "ordered"
        : typeof item.attrs.checked === "boolean" ? "task" : "bullet";
      units.push({
        type: "list-item",
        item,
        kind,
        order: node.type === noteSchema.nodes.ordered_list
          ? Number(node.attrs.order) + index
          : 1,
        selected: selectionIntersects(
          state.selection,
          itemPosition,
          itemPosition + item.nodeSize,
        ),
      });
      offset += item.nodeSize;
    });
  });
  return units;
}

function convertSelectedUnits(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  kind: ListKind,
): boolean {
  const collapsedList = state.selection.empty ? nearestList(state) : null;
  if (state.selection.empty && (!collapsedList || collapsedList.depth !== 1)) return false;
  const units = selectedUnits(state);
  const selected = units.filter((unit) => unit.selected);
  if (!selected.some((unit) => unit.type === "list-item")) return false;

  const removeList = selected.every(
    (unit) => unit.type === "list-item" && unit.kind === kind,
  );
  if (!dispatch) return true;

  const rebuilt: RebuildUnit[] = [];
  for (const unit of units) {
    if (!unit.selected) {
      rebuilt.push(unit);
      continue;
    }
    if (removeList && unit.type === "list-item") {
      const content = unit.item.attrs.checked === true
        ? addCompletedPrefix(unit.item.content)
        : unit.item.content;
      content.forEach((node) => {
        rebuilt.push({ type: "block", node, selected: true });
      });
      continue;
    }

    const content = unit.type === "list-item"
      ? unit.item.content
      : Fragment.from(noteSchema.nodes.paragraph.create(null, unit.node.content));
    const converted = convertedItemContent(
      content,
      unit.type === "list-item" ? unit.item.attrs.checked : null,
      kind,
    );
    rebuilt.push({
      type: "list-item",
      item: noteSchema.nodes.list_item.create(
        { checked: converted.checked },
        converted.content,
      ),
      kind,
      order: 1,
      selected: true,
    });
  }

  const nodes: ProseMirrorNode[] = [];
  const selectedRanges: Array<{ from: number; to: number }> = [];
  let documentPosition = 0;
  for (let index = 0; index < rebuilt.length;) {
    const unit = rebuilt[index]!;
    if (unit.type === "block") {
      nodes.push(unit.node);
      if (unit.selected) {
        if (unit.node.isTextblock) {
          selectedRanges.push({
            from: documentPosition + 1,
            to: documentPosition + 1 + unit.node.content.size,
          });
        } else {
          unit.node.descendants((node, relativePosition) => {
            if (!node.isTextblock) return;
            selectedRanges.push({
              from: documentPosition + relativePosition + 2,
              to: documentPosition + relativePosition + 2 + node.content.size,
            });
          });
        }
      }
      documentPosition += unit.node.nodeSize;
      index += 1;
      continue;
    }

    const items: ListItemUnit[] = [unit];
    let nextIndex = index + 1;
    while (nextIndex < rebuilt.length) {
      const nextUnit = rebuilt[nextIndex];
      if (!nextUnit || nextUnit.type !== "list-item" || nextUnit.kind !== unit.kind) break;
      items.push(nextUnit);
      nextIndex += 1;
    }
    const list = (unit.kind === "ordered"
      ? noteSchema.nodes.ordered_list
      : noteSchema.nodes.bullet_list).create(
      unit.kind === "ordered" ? { order: unit.order } : undefined,
      items.map((item) => item.item),
    );
    let itemOffset = 0;
    for (const item of items) {
      if (item.selected) {
        const paragraph = item.item.firstChild;
        selectedRanges.push({
          from: documentPosition + itemOffset + 3,
          to: documentPosition + itemOffset + 3 + (paragraph?.content.size ?? 0),
        });
      }
      itemOffset += item.item.nodeSize;
    }
    nodes.push(list);
    documentPosition += list.nodeSize;
    index = nextIndex;
  }

  const nextDoc = noteSchema.nodes.doc.create(null, nodes);
  const transaction = state.tr.replaceWith(0, state.doc.content.size, nextDoc.content);
  if (selectedRanges.length > 0) {
    const first = selectedRanges[0]!;
    const last = selectedRanges[selectedRanges.length - 1]!;
    transaction.setSelection(TextSelection.create(
      transaction.doc,
      state.selection.empty
        ? first.from + Math.min(state.selection.$from.parentOffset, first.to - first.from)
        : first.from,
      state.selection.empty ? undefined : last.to,
    ));
  }
  dispatch(transaction.scrollIntoView());
  return true;
}

export function toggleList(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  kind: ListKind,
): boolean {
  if (convertSelectedUnits(state, dispatch, kind)) return true;

  const current = listKind(state);
  if (current === kind) {
    if (current === "task" && dispatch) {
      const existing = nearestList(state);
      if (!existing) return false;
      const transaction = state.tr.replaceWith(
        existing.position,
        existing.position + existing.node.nodeSize,
        convertListNode(existing.node, "bullet"),
      );
      const preparedState = state.apply(transaction);
      let liftTransaction: Transaction | null = null;
      if (!liftListItem(noteSchema.nodes.list_item)(preparedState, (next) => {
        liftTransaction = next;
      }) || !liftTransaction) return false;
      for (const step of (liftTransaction as Transaction).steps) transaction.step(step);
      dispatch(transaction.scrollIntoView());
      return true;
    }
    return liftListItem(noteSchema.nodes.list_item)(state, dispatch);
  }

  const existing = nearestList(state);
  const targetType = kind === "ordered"
    ? noteSchema.nodes.ordered_list
    : noteSchema.nodes.bullet_list;
  if (existing) {
    if (dispatch) {
      const transaction = state.tr.replaceWith(
        existing.position,
        existing.position + existing.node.nodeSize,
        convertListNode(existing.node, kind),
      );
      dispatch(transaction.scrollIntoView());
    }
    return true;
  }

  return wrapInList(targetType)(state, dispatch && ((transaction) => {
    if (kind === "task") {
      const wrapped = nearestList(transaction);
      if (wrapped) {
        const selection = transaction.selection;
        transaction.replaceWith(
          wrapped.position,
          wrapped.position + wrapped.node.nodeSize,
          convertListNode(wrapped.node, kind),
        );
        if (!selection.empty) {
          transaction.setSelection(TextSelection.create(
            transaction.doc,
            selection.from,
            selection.to,
          ));
        }
      }
    }
    dispatch(transaction.scrollIntoView());
  }));
}

class RichEditor implements EditorController {
  readonly mode = "wysiwyg" as const;
  private readonly view: EditorView;

  constructor(private readonly host: HTMLElement, doc: ProseMirrorNode, private readonly callbacks: EditorCallbacks, spellcheck: boolean) {
    this.view = new EditorView(host, {
      attributes: { spellcheck: String(spellcheck) },
      scrollMargin: { top: 8, right: 0, bottom: 8, left: 0 },
      state: EditorState.create({
        schema: noteSchema,
        doc,
        plugins: [
          inputRulePlugin(),
          listNormalizationPlugin(),
          history(),
          rowDragPlugin(),
          rowInsertPlugin(),
          keymap({
            "Mod-z": undo,
            "Mod-y": redo,
            "Mod-Shift-z": redo,
            Enter: splitCurrentListItem,
            Backspace: chainCommands(exitEmptyListItem, joinEmptyParagraphAfterList),
            Tab: chainCommands(
              sinkListItemAcrossTypes,
              sinkListItem(noteSchema.nodes.list_item),
            ),
            "Shift-Tab": liftListItem(noteSchema.nodes.list_item),
          }),
          keymap(baseKeymap),
        ],
      }),
      dispatchTransaction: (transaction) => {
        const next = this.view.state.apply(transaction);
        this.view.updateState(next);
        if (transaction.docChanged) this.callbacks.onChange(serializeMarkdown(next.doc));
        if (transaction.selectionSet || transaction.docChanged) this.callbacks.onSelectionChange();
      },
      handleDOMEvents: {
        mousedown: (_view, event) => {
          const target = event.target;
          if (
            target instanceof HTMLInputElement
            && target.dataset.taskCheckbox === "true"
          ) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        change: (view, event) => {
          const target = event.target;
          if (
            !(target instanceof HTMLInputElement)
            || target.dataset.taskCheckbox !== "true"
          ) {
            return false;
          }
          const item = target.closest("li.task-list-item");
          if (!item) return false;
          const position = view.posAtDOM(item, 0) - 1;
          const node = view.state.doc.nodeAt(position);
          if (node?.type !== noteSchema.nodes.list_item) return false;
          const hadFocus = view.hasFocus();
          view.dispatch(view.state.tr.setNodeMarkup(position, undefined, {
            ...node.attrs,
            checked: target.checked,
          }));
          if (hadFocus) {
            restoreNativeSelection(
              view,
              view.state.selection.anchor,
              view.state.selection.head,
            );
          }
          return true;
        },
        focus: () => {
          this.callbacks.onFocusChange(true);
          return false;
        },
        blur: () => {
          this.callbacks.onFocusChange(false);
          return false;
        },
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        const fragment = parseSupportedFragment(text);
        const slice = fragment ? Slice.maxOpen(fragment.content) : literalTextSlice(text);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
      clipboardTextSerializer: (slice) => {
        try {
          return serializeMarkdown(noteSchema.nodes.doc.create(null, slice.content));
        } catch {
          return slice.content.textBetween(0, slice.content.size, "\n");
        }
      },
    });
  }

  getMarkdown(): string {
    return serializeMarkdown(this.view.state.doc);
  }

  run(action: EditorAction): void {
    if (action === "strong" || action === "em" || action === "strike") {
      toggleMark(noteSchema.marks[action])(this.view.state, this.view.dispatch);
    } else if (action === "heading") {
      this.toggleHeading();
    } else {
      this.setList(action);
    }
    this.view.focus();
    this.callbacks.onSelectionChange();
  }

  activeActions(): Set<EditorAction> {
    const active = new Set<EditorAction>();
    const state = this.view.state;
    for (const markName of ["strong", "em", "strike"] as const) {
      const mark = noteSchema.marks[markName];
      if (state.selection.empty ? mark.isInSet(state.storedMarks ?? state.selection.$from.marks()) : state.doc.rangeHasMark(state.selection.from, state.selection.to, mark)) {
        active.add(markName);
      }
    }
    if (state.selection.$from.parent.type === noteSchema.nodes.heading) active.add("heading");
    const kind = listKind(state);
    if (kind) active.add(kind);
    return active;
  }

  setSpellcheck(enabled: boolean): void {
    this.view.dom.spellcheck = enabled;
  }

  focus(): void {
    this.view.focus();
  }

  ensureSelectionVisible(bottomInset = 0): void {
    keepRectVisible(
      this.host,
      this.view.coordsAtPos(this.view.state.selection.head),
      bottomInset,
    );
  }

  destroy(): void {
    this.view.destroy();
  }

  private toggleHeading(): void {
    const state = this.view.state;
    if (state.selection.$from.parent.type === noteSchema.nodes.heading) {
      setBlockType(noteSchema.nodes.paragraph)(state, this.view.dispatch);
      return;
    }
    while (nearestList(this.view.state)) {
      if (!liftListItem(noteSchema.nodes.list_item)(this.view.state, this.view.dispatch)) break;
    }
    setBlockType(noteSchema.nodes.heading, { level: 1 })(this.view.state, this.view.dispatch);
  }

  private setList(kind: ListKind): void {
    toggleList(this.view.state, this.view.dispatch, kind);
  }

}

class RawEditor implements EditorController {
  readonly mode = "raw" as const;
  private readonly textarea: HTMLTextAreaElement;

  constructor(host: HTMLElement, content: string, callbacks: EditorCallbacks, spellcheck: boolean) {
    this.textarea = document.createElement("textarea");
    this.textarea.className = "raw-editor";
    this.textarea.value = content;
    this.textarea.setAttribute("spellcheck", String(spellcheck));
    this.textarea.addEventListener("input", () => callbacks.onChange(this.textarea.value));
    this.textarea.addEventListener("focus", () => callbacks.onFocusChange(true));
    this.textarea.addEventListener("blur", () => callbacks.onFocusChange(false));
    host.append(this.textarea);
  }

  getMarkdown(): string {
    return this.textarea.value;
  }

  run(_action: EditorAction): void {}

  activeActions(): Set<EditorAction> {
    return new Set();
  }

  setSpellcheck(enabled: boolean): void {
    this.textarea.spellcheck = enabled;
  }

  focus(): void {
    this.textarea.focus();
  }

  ensureSelectionVisible(_bottomInset = 0): void {}

  destroy(): void {
    this.textarea.remove();
  }
}

export function createEditor(
  host: HTMLElement,
  markdown: string,
  callbacks: EditorCallbacks,
  spellcheck = false,
): { controller: EditorController; snapshot: EditorSnapshot } {
  const parsed = parseMarkdown(markdown);
  if (parsed.mode === "raw") {
    return {
      controller: new RawEditor(host, parsed.markdown, callbacks, spellcheck),
      snapshot: { mode: "raw", markdown: parsed.markdown, rawReason: parsed.reason },
    };
  }
  return {
    controller: new RichEditor(host, parsed.doc, callbacks, spellcheck),
    snapshot: { mode: "wysiwyg", markdown: parsed.markdown },
  };
}
