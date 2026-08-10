import createLucideElement from "lucide/dist/esm/createElement.mjs";
import GripVertical from "lucide/dist/esm/icons/grip-vertical.mjs";
import Trash2 from "lucide/dist/esm/icons/trash-2.mjs";
import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { type EditorView } from "prosemirror-view";

import { normalizeListDocument } from "./list-normalization";
import {
  alignDocumentBoundary,
  autoScrollForPointer,
  preserveViewportDuring,
  scrollForWheel,
} from "./editor-viewport";
import { FOLD_HOVER_EVENT, type FoldHoverDetail } from "./folding";
import { noteSchema } from "./schema";
import { terminalBlankTextblock } from "./row-insert";
import { t } from "../i18n";

export type RowDropSide = "before" | "after" | "inside";

type ListKind = "bullet" | "ordered" | "task";
type DocumentEndAnchorEdge = "top" | "bottom";
const DELETE_TARGET_HIT_PADDING = 6;

interface RowDescriptor {
  node: ProseMirrorNode;
  position: number;
  dom: HTMLElement;
  header: HTMLElement;
}

interface TerminalEmptyTail {
  element: HTMLElement;
  rowPosition: number;
}

function nodeAtPath(node: ProseMirrorNode, path: readonly number[]): ProseMirrorNode {
  let current = node;
  for (const index of path) current = current.child(index);
  return current;
}

function findNodePath(
  root: ProseMirrorNode,
  wanted: ProseMirrorNode,
  path: number[] = [],
): number[] | null {
  if (root === wanted) return path;
  for (let index = 0; index < root.childCount; index += 1) {
    const found = findNodePath(root.child(index), wanted, [...path, index]);
    if (found) return found;
  }
  return null;
}

function pathStartsWith(path: readonly number[], prefix: readonly number[]): boolean {
  return prefix.length <= path.length
    && prefix.every((index, depth) => path[depth] === index);
}

function copyWithChildren(
  node: ProseMirrorNode,
  children: readonly ProseMirrorNode[],
): ProseMirrorNode {
  return node.copy(Fragment.fromArray([...children]));
}

function replaceNodeAtPath(
  root: ProseMirrorNode,
  path: readonly number[],
  replacement: ProseMirrorNode | null,
): ProseMirrorNode {
  if (path.length === 0) {
    if (!replacement) throw new Error("The document root cannot be removed.");
    return replacement;
  }
  const [index, ...rest] = path;
  const children: ProseMirrorNode[] = [];
  root.forEach((child) => children.push(child));
  if (rest.length === 0) {
    if (replacement) children[index!] = replacement;
    else children.splice(index!, 1);
  } else {
    children[index!] = replaceNodeAtPath(children[index!]!, rest, replacement);
  }
  return copyWithChildren(root, children);
}

function replaceNodeAtPathWithNodes(
  root: ProseMirrorNode,
  path: readonly number[],
  replacements: readonly ProseMirrorNode[],
): ProseMirrorNode {
  if (path.length === 0) throw new Error("The document root cannot be replaced with siblings.");
  const [index, ...rest] = path;
  const children: ProseMirrorNode[] = [];
  root.forEach((child) => children.push(child));
  if (rest.length === 0) {
    children.splice(index!, 1, ...replacements);
  } else {
    children[index!] = replaceNodeAtPathWithNodes(children[index!]!, rest, replacements);
  }
  return copyWithChildren(root, children);
}

function insertNodeAtPath(
  root: ProseMirrorNode,
  parentPath: readonly number[],
  index: number,
  inserted: ProseMirrorNode,
): ProseMirrorNode {
  const parent = nodeAtPath(root, parentPath);
  const children: ProseMirrorNode[] = [];
  parent.forEach((child) => children.push(child));
  children.splice(index, 0, inserted);
  return replaceNodeAtPath(root, parentPath, copyWithChildren(parent, children));
}

function insertNodesAtPath(
  root: ProseMirrorNode,
  parentPath: readonly number[],
  index: number,
  inserted: readonly ProseMirrorNode[],
): ProseMirrorNode {
  const parent = nodeAtPath(root, parentPath);
  const children: ProseMirrorNode[] = [];
  parent.forEach((child) => children.push(child));
  children.splice(index, 0, ...inserted);
  return replaceNodeAtPath(root, parentPath, copyWithChildren(parent, children));
}

function headingSectionEndIndex(root: ProseMirrorNode, headingIndex: number): number {
  let index = headingIndex + 1;
  while (index < root.childCount && root.child(index).type !== noteSchema.nodes.heading) {
    index += 1;
  }
  return index;
}

function pathIsWithinDraggedBlock(
  root: ProseMirrorNode,
  sourcePath: readonly number[],
  targetPath: readonly number[],
): boolean {
  const source = nodeAtPath(root, sourcePath);
  if (source.type !== noteSchema.nodes.heading) return pathStartsWith(targetPath, sourcePath);
  const start = sourcePath[0]!;
  return targetPath[0]! >= start && targetPath[0]! < headingSectionEndIndex(root, start);
}

function headingOwnerIndex(
  root: ProseMirrorNode,
  targetPath: readonly number[],
): number | null {
  for (let index = targetPath[0]!; index >= 0; index -= 1) {
    if (root.child(index).type === noteSchema.nodes.heading) return index;
  }
  return null;
}

function nodePositionAtPath(root: ProseMirrorNode, path: readonly number[]): number {
  let node = root;
  let position = 0;
  path.forEach((index, depth) => {
    for (let siblingIndex = 0; siblingIndex < index; siblingIndex += 1) {
      position += node.child(siblingIndex).nodeSize;
    }
    node = node.child(index);
    if (depth < path.length - 1) position += 1;
  });
  return position;
}

function listItemAncestorPaths(
  root: ProseMirrorNode,
  path: readonly number[],
): number[][] {
  const ancestors: number[][] = [];
  for (let length = 1; length <= path.length; length += 1) {
    const candidate = path.slice(0, length);
    if (nodeAtPath(root, candidate).type === noteSchema.nodes.list_item) {
      ancestors.push(candidate);
    }
  }
  return ancestors;
}

function visibleRowCount(node: ProseMirrorNode): number {
  if (node.type === noteSchema.nodes.list_item) {
    let count = 1;
    node.descendants((descendant) => {
      if (descendant.type === noteSchema.nodes.list_item) count += 1;
    });
    return count;
  }
  if (
    node.type === noteSchema.nodes.bullet_list
    || node.type === noteSchema.nodes.ordered_list
  ) {
    let count = 0;
    node.descendants((descendant) => {
      if (descendant.type === noteSchema.nodes.list_item) count += 1;
    });
    return count;
  }
  return 1;
}

function draggedRowCount(root: ProseMirrorNode, path: readonly number[]): number {
  const source = nodeAtPath(root, path);
  if (source.type !== noteSchema.nodes.heading) return visibleRowCount(source);
  const start = path[0]!;
  const end = headingSectionEndIndex(root, start);
  let count = 0;
  for (let index = start; index < end; index += 1) {
    count += visibleRowCount(root.child(index));
  }
  return count;
}

function listItemKind(list: ProseMirrorNode, item: ProseMirrorNode): ListKind {
  if (list.type === noteSchema.nodes.ordered_list) return "ordered";
  return typeof item.attrs.checked === "boolean" ? "task" : "bullet";
}

function listItemForKind(
  source: ProseMirrorNode,
  kind: ListKind,
  sourceKind: ListKind | null,
): ProseMirrorNode {
  if (source.type === noteSchema.nodes.list_item && sourceKind === kind) return source;
  const content = source.type === noteSchema.nodes.list_item
    ? source.content
    : source;
  const checked = kind === "task"
    ? sourceKind === "task" ? Boolean(source.attrs.checked) : false
    : null;
  return noteSchema.nodes.list_item.create(
    {
      ...(source.type === noteSchema.nodes.list_item ? source.attrs : {}),
      checked,
    },
    content,
  );
}

function rootNodeForSource(
  source: ProseMirrorNode,
  sourceKind: ListKind | null,
): { node: ProseMirrorNode; selected: ProseMirrorNode } {
  if (source.type !== noteSchema.nodes.list_item) return { node: source, selected: source };
  const list = (sourceKind === "ordered"
    ? noteSchema.nodes.ordered_list
    : noteSchema.nodes.bullet_list).create(
    sourceKind === "ordered" ? { order: 1 } : undefined,
    source,
  );
  return { node: list, selected: source };
}

function removeRowAtPath(
  root: ProseMirrorNode,
  path: readonly number[],
): ProseMirrorNode {
  const source = nodeAtPath(root, path);
  if (source.type !== noteSchema.nodes.list_item) {
    return replaceNodeAtPath(root, path, null);
  }
  const listPath = path.slice(0, -1);
  const list = nodeAtPath(root, listPath);
  if (list.childCount === 1) return replaceNodeAtPath(root, listPath, null);
  return replaceNodeAtPath(
    root,
    listPath,
    replaceNodeAtPath(list, [path[path.length - 1]!], null),
  );
}

function isDraggableRowAtPath(root: ProseMirrorNode, path: readonly number[]): boolean {
  const node = nodeAtPath(root, path);
  if (node.type === noteSchema.nodes.list_item) {
    const parent = nodeAtPath(root, path.slice(0, -1));
    return parent.type === noteSchema.nodes.bullet_list
      || parent.type === noteSchema.nodes.ordered_list;
  }
  return path.length === 1
    && (node.type === noteSchema.nodes.paragraph || node.type === noteSchema.nodes.heading);
}

function textPositionFor(
  doc: ProseMirrorNode,
  parent: ProseMirrorNode,
  parentOffset: number,
): number | null {
  let result: number | null = null;
  doc.descendants((node, position) => {
    if (node === parent) {
      result = position + 1 + Math.min(parentOffset, node.content.size);
      return false;
    }
    return result === null;
  });
  return result;
}

function changedDocumentRange(
  previous: ProseMirrorNode,
  next: ProseMirrorNode,
): { from: number; previousTo: number; nextTo: number } {
  let prefixCount = 0;
  while (
    prefixCount < previous.childCount
    && prefixCount < next.childCount
    && previous.child(prefixCount).eq(next.child(prefixCount))
  ) {
    prefixCount += 1;
  }

  let suffixCount = 0;
  while (
    suffixCount < previous.childCount - prefixCount
    && suffixCount < next.childCount - prefixCount
    && previous.child(previous.childCount - suffixCount - 1)
      .eq(next.child(next.childCount - suffixCount - 1))
  ) {
    suffixCount += 1;
  }

  let from = 0;
  for (let index = 0; index < prefixCount; index += 1) {
    from += previous.child(index).nodeSize;
  }
  let previousTo = previous.content.size;
  let nextTo = next.content.size;
  for (let index = 0; index < suffixCount; index += 1) {
    previousTo -= previous.child(previous.childCount - index - 1).nodeSize;
    nextTo -= next.child(next.childCount - index - 1).nodeSize;
  }
  return { from, previousTo, nextTo };
}

function nestedListIndex(item: ProseMirrorNode): number | null {
  for (let index = 0; index < item.childCount; index += 1) {
    const child = item.child(index);
    if (
      child.type === noteSchema.nodes.bullet_list
      || child.type === noteSchema.nodes.ordered_list
    ) {
      return index;
    }
  }
  return null;
}

function listForKind(kind: ListKind, item: ProseMirrorNode): ProseMirrorNode {
  return (kind === "ordered"
    ? noteSchema.nodes.ordered_list
    : noteSchema.nodes.bullet_list).create(
    kind === "ordered" ? { order: 1 } : undefined,
    item,
  );
}

function dispatchMovedDocument(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  nextDoc: ProseMirrorNode,
  selectionAnchor: { parent: ProseMirrorNode; offset: number },
  selectionHead: { parent: ProseMirrorNode; offset: number },
): boolean {
  nextDoc = normalizeListDocument(nextDoc);
  if (nextDoc.eq(state.doc)) return false;
  if (!dispatch) return true;

  const changed = changedDocumentRange(state.doc, nextDoc);
  const transaction = state.tr.replace(
    changed.from,
    changed.previousTo,
    nextDoc.slice(changed.from, changed.nextTo),
  );
  const nextAnchor = textPositionFor(
    transaction.doc,
    selectionAnchor.parent,
    selectionAnchor.offset,
  );
  const nextHead = textPositionFor(
    transaction.doc,
    selectionHead.parent,
    selectionHead.offset,
  );
  if (nextAnchor !== null && nextHead !== null) {
    transaction.setSelection(TextSelection.create(transaction.doc, nextAnchor, nextHead));
  }
  dispatch(transaction.setMeta("rowDrag", true));
  return true;
}

export function deleteRow(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  sourcePosition: number,
): boolean {
  const source = state.doc.nodeAt(sourcePosition);
  if (!source) return false;
  const sourcePath = findNodePath(state.doc, source);
  if (!sourcePath || !isDraggableRowAtPath(state.doc, sourcePath)) return false;

  let nextDoc: ProseMirrorNode;
  if (source.type === noteSchema.nodes.heading) {
    const start = sourcePath[0]!;
    const children: ProseMirrorNode[] = [];
    state.doc.forEach((child) => children.push(child));
    children.splice(start, headingSectionEndIndex(state.doc, start) - start);
    nextDoc = copyWithChildren(state.doc, children);
  } else {
    nextDoc = removeRowAtPath(state.doc, sourcePath);
  }
  if (nextDoc.childCount === 0) {
    nextDoc = noteSchema.nodes.doc.create(null, noteSchema.nodes.paragraph.create());
  }
  nextDoc = normalizeListDocument(nextDoc);
  if (nextDoc.eq(state.doc)) return false;
  if (!dispatch) return true;

  const changed = changedDocumentRange(state.doc, nextDoc);
  dispatch(state.tr.replace(
    changed.from,
    changed.previousTo,
    nextDoc.slice(changed.from, changed.nextTo),
  ).setMeta("rowDrag", true));
  return true;
}

export function moveRow(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  sourcePosition: number,
  targetPosition: number,
  side: RowDropSide,
): boolean {
  const selectionAnchor = {
    parent: state.selection.$anchor.parent,
    offset: state.selection.$anchor.parentOffset,
  };
  const selectionHead = {
    parent: state.selection.$head.parent,
    offset: state.selection.$head.parentOffset,
  };
  const source = state.doc.nodeAt(sourcePosition);
  let target = state.doc.nodeAt(targetPosition);
  if (!source || !target || source === target) return false;

  const sourcePath = findNodePath(state.doc, source);
  let targetPath = findNodePath(state.doc, target);
  if (
    !sourcePath
    || !targetPath
    || !isDraggableRowAtPath(state.doc, sourcePath)
    || !isDraggableRowAtPath(state.doc, targetPath)
    || pathIsWithinDraggedBlock(state.doc, sourcePath, targetPath)
  ) {
    return false;
  }

  if (source.type === noteSchema.nodes.heading && target.type !== noteSchema.nodes.heading) {
    const ownerIndex = headingOwnerIndex(state.doc, targetPath);
    if (ownerIndex !== null) {
      target = state.doc.child(ownerIndex);
      targetPath = [ownerIndex];
      side = "after";
    }
  }
  if (
    side === "inside"
    && target.type !== noteSchema.nodes.list_item
    && target.type !== noteSchema.nodes.heading
  ) return false;


  if (source.type === noteSchema.nodes.heading) {
    const sectionStart = sourcePath[0]!;
    const sectionEnd = headingSectionEndIndex(state.doc, sectionStart);
    const section: ProseMirrorNode[] = [];
    for (let index = sectionStart; index < sectionEnd; index += 1) {
      section.push(state.doc.child(index));
    }

    const children: ProseMirrorNode[] = [];
    state.doc.forEach((child) => children.push(child));
    children.splice(sectionStart, sectionEnd - sectionStart);
    let nextDoc = copyWithChildren(state.doc, children);
    const nextTargetPath = findNodePath(nextDoc, target);
    if (!nextTargetPath) return false;

    if (target.type === noteSchema.nodes.list_item) {
      const listPath = nextTargetPath.slice(0, -1);
      const list = nodeAtPath(nextDoc, listPath);
      const targetIndex = nextTargetPath[nextTargetPath.length - 1]!;
      const insertionIndex = targetIndex + (side === "after" ? 1 : 0);
      if (listPath.length === 1) {
        const listChildren: ProseMirrorNode[] = [];
        list.forEach((child) => listChildren.push(child));
        const replacements: ProseMirrorNode[] = [];
        if (insertionIndex > 0) {
          replacements.push(copyWithChildren(list, listChildren.slice(0, insertionIndex)));
        }
        replacements.push(...section);
        if (insertionIndex < list.childCount) {
          replacements.push(copyWithChildren(list, listChildren.slice(insertionIndex)));
        }
        nextDoc = replaceNodeAtPathWithNodes(nextDoc, listPath, replacements);
      } else {
        const topLevelIndex = nextTargetPath[0]!;
        nextDoc = insertNodesAtPath(
          nextDoc,
          [],
          topLevelIndex + (side === "after" ? 1 : 0),
          section,
        );
      }
    } else {
      const targetIndex = nextTargetPath[0]!;
      const insertionIndex = target.type === noteSchema.nodes.heading && side === "after"
        ? headingSectionEndIndex(nextDoc, targetIndex)
        : targetIndex + (side === "after" ? 1 : 0);
      nextDoc = insertNodesAtPath(nextDoc, [], insertionIndex, section);
    }

    return dispatchMovedDocument(
      state,
      dispatch,
      nextDoc,
      selectionAnchor,
      selectionHead,
    );
  }

  let sourceKind: ListKind | null = null;
  if (source.type === noteSchema.nodes.list_item) {
    sourceKind = listItemKind(nodeAtPath(state.doc, sourcePath.slice(0, -1)), source);
  }

  let nextDoc = removeRowAtPath(state.doc, sourcePath);
  const nextTargetPath = pathStartsWith(sourcePath, targetPath)
    ? targetPath
    : findNodePath(nextDoc, target);
  if (!nextTargetPath) return false;

  if (side === "inside" && target.attrs.collapsed) {
    const nextTarget = nodeAtPath(nextDoc, nextTargetPath);
    nextDoc = replaceNodeAtPath(
      nextDoc,
      nextTargetPath,
      nextTarget.type.create(
        { ...nextTarget.attrs, collapsed: false },
        nextTarget.content,
        nextTarget.marks,
      ),
    );
  }

  let selectedNode: ProseMirrorNode;
  if (target.type === noteSchema.nodes.list_item) {
    const nextTarget = nodeAtPath(nextDoc, nextTargetPath);
    if (side === "inside") {
      const childListIndex = nestedListIndex(nextTarget);
      if (childListIndex !== null) {
        const childListPath = [...nextTargetPath, childListIndex];
        const childList = nodeAtPath(nextDoc, childListPath);
        selectedNode = listItemForKind(
          source,
          listItemKind(childList, childList.lastChild!),
          sourceKind,
        );
        nextDoc = insertNodeAtPath(
          nextDoc,
          childListPath,
          childList.childCount,
          selectedNode,
        );
      } else {
        const parentList = nodeAtPath(nextDoc, nextTargetPath.slice(0, -1));
        const targetKind = listItemKind(parentList, nextTarget);
        const childKind = sourceKind ?? targetKind;
        selectedNode = listItemForKind(source, childKind, sourceKind);
        nextDoc = insertNodeAtPath(
          nextDoc,
          nextTargetPath,
          nextTarget.childCount,
          listForKind(childKind, selectedNode),
        );
      }
    } else {
      const listPath = nextTargetPath.slice(0, -1);
      const list = nodeAtPath(nextDoc, listPath);
      const targetIndex = nextTargetPath[nextTargetPath.length - 1]!;
      const insertionIndex = targetIndex + (side === "after" ? 1 : 0);
      const referenceIndex = side === "after" || targetIndex === 0
        ? targetIndex
        : targetIndex - 1;
      const reference = list.child(referenceIndex);
      const targetKind = listItemKind(list, reference);
      selectedNode = listItemForKind(source, targetKind, sourceKind);
      nextDoc = insertNodeAtPath(nextDoc, listPath, insertionIndex, selectedNode);
    }
  } else {
    const targetIndex = nextTargetPath[0]!;
    const insertionIndex = side === "inside" && target.type === noteSchema.nodes.heading
      ? headingSectionEndIndex(nextDoc, targetIndex)
      : targetIndex + (side === "after" ? 1 : 0);
    const root = rootNodeForSource(source, sourceKind);
    selectedNode = root.selected;
    nextDoc = insertNodeAtPath(nextDoc, [], insertionIndex, root.node);
  }

  return dispatchMovedDocument(state, dispatch, nextDoc, selectionAnchor, selectionHead);
}

export function moveRowToDocumentEnd(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  sourcePosition: number,
): boolean {
  const source = state.doc.nodeAt(sourcePosition);
  if (!source) return false;
  const sourcePath = findNodePath(state.doc, source);
  if (!sourcePath || !isDraggableRowAtPath(state.doc, sourcePath)) return false;
  const selectionAnchor = {
    parent: state.selection.$anchor.parent,
    offset: state.selection.$anchor.parentOffset,
  };
  const selectionHead = {
    parent: state.selection.$head.parent,
    offset: state.selection.$head.parentOffset,
  };

  let nextDoc: ProseMirrorNode;
  let appended: ProseMirrorNode[];
  if (source.type === noteSchema.nodes.heading) {
    const start = sourcePath[0]!;
    const end = headingSectionEndIndex(state.doc, start);
    appended = [];
    for (let index = start; index < end; index += 1) appended.push(state.doc.child(index));
    const children: ProseMirrorNode[] = [];
    state.doc.forEach((child) => children.push(child));
    children.splice(start, end - start);
    nextDoc = copyWithChildren(state.doc, children);
  } else {
    let sourceKind: ListKind | null = null;
    if (source.type === noteSchema.nodes.list_item) {
      sourceKind = listItemKind(nodeAtPath(state.doc, sourcePath.slice(0, -1)), source);
    }
    nextDoc = removeRowAtPath(state.doc, sourcePath);
    appended = [rootNodeForSource(source, sourceKind).node];
  }
  nextDoc = insertNodesAtPath(nextDoc, [], nextDoc.childCount, appended);
  return dispatchMovedDocument(
    state,
    dispatch,
    nextDoc,
    selectionAnchor,
    selectionHead,
  );
}

function rowPositionAt(view: EditorView, documentPosition: number): number | null {
  const position = Math.max(0, Math.min(documentPosition, view.state.doc.content.size));
  const $position = view.state.doc.resolve(position);
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    if ($position.node(depth).type === noteSchema.nodes.list_item) {
      return $position.before(depth);
    }
  }
  if ($position.depth >= 1) {
    const node = $position.node(1);
    if (node.type === noteSchema.nodes.paragraph || node.type === noteSchema.nodes.heading) {
      return $position.before(1);
    }
  }
  return null;
}

function rowHeader(dom: HTMLElement, node: ProseMirrorNode): HTMLElement | null {
  if (node.type !== noteSchema.nodes.list_item) return dom;
  if (dom.classList.contains("task-list-item")) {
    return dom.querySelector<HTMLElement>(":scope > .task-content > p");
  }
  return Array.from(dom.children).find((child) => child.tagName === "P") as HTMLElement | undefined
    ?? null;
}

function unshiftedVerticalRect(element: HTMLElement): { top: number; bottom: number } {
  const rect = element.getBoundingClientRect();
  const shift = Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--editor-text-shift-y"),
  ) || 0;
  return { top: rect.top - shift, bottom: rect.bottom - shift };
}

function rowHeaderVerticalRect(element: HTMLElement): { top: number; bottom: number } {
  const rect = unshiftedVerticalRect(element);
  if (!element.classList.contains("is-terminal-empty-line")) return rect;
  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 21;
  return { top: rect.top, bottom: Math.min(rect.bottom, rect.top + lineHeight) };
}

function topLevelNodePosition(root: ProseMirrorNode, index: number): number {
  let position = 0;
  for (let childIndex = 0; childIndex < index; childIndex += 1) {
    position += root.child(childIndex).nodeSize;
  }
  return position;
}

function draggedBlockVerticalRect(
  view: EditorView,
  row: RowDescriptor,
): { top: number; bottom: number } {
  const headerRect = rowHeaderVerticalRect(row.header);
  if (row.node.type === noteSchema.nodes.list_item) {
    if (row.header.classList.contains("is-terminal-empty-line") && row.node.childCount === 1) {
      return headerRect;
    }
    return { top: headerRect.top, bottom: unshiftedVerticalRect(row.dom).bottom };
  }
  if (row.node.type !== noteSchema.nodes.heading) return headerRect;
  if (row.node.attrs.collapsed) return headerRect;

  const sourcePath = findNodePath(view.state.doc, row.node);
  if (!sourcePath) return headerRect;
  const lastIndex = headingSectionEndIndex(view.state.doc, sourcePath[0]!) - 1;
  const lastDom = view.nodeDOM(topLevelNodePosition(view.state.doc, lastIndex));
  if (!(lastDom instanceof HTMLElement)) return headerRect;
  return { top: headerRect.top, bottom: unshiftedVerticalRect(lastDom).bottom };
}

function rowAt(view: EditorView, clientX: number, clientY: number): RowDescriptor | null {
  const editorRect = view.dom.getBoundingClientRect();
  const coordinates = view.posAtCoords({
    left: Math.max(editorRect.left + 2, Math.min(clientX, editorRect.right - 2)),
    top: clientY,
  });
  if (!coordinates) return null;
  const candidates = [coordinates.pos, coordinates.inside >= 0 ? coordinates.inside + 1 : -1];
  for (const candidate of candidates) {
    if (candidate < 0) continue;
    const position = rowPositionAt(view, candidate);
    if (position === null) continue;
    const row = rowAtPosition(view, position);
    if (row) return row;
  }
  return null;
}

function rowAtPosition(view: EditorView, position: number): RowDescriptor | null {
  const node = view.state.doc.nodeAt(position);
  const dom = view.nodeDOM(position);
  if (!node || !(dom instanceof HTMLElement)) return null;
  const header = rowHeader(dom, node);
  return header ? { node, position, dom, header } : null;
}

class RowDragHandleView {
  private readonly host: HTMLElement;
  private readonly handle: HTMLButtonElement;
  private readonly highlight: HTMLDivElement;
  private readonly indicator: HTMLDivElement;
  private readonly insideIndicator: HTMLDivElement;
  private readonly preview: HTMLDivElement;
  private readonly previewText: HTMLSpanElement;
  private readonly previewMeta: HTMLSpanElement;
  private readonly deleteTarget: HTMLDivElement;
  private hovered: RowDescriptor | null = null;
  private foldHovered: RowDescriptor | null = null;
  private source: RowDescriptor | null = null;
  private target: RowDescriptor | null = null;
  private side: RowDropSide = "after";
  private visualAnchor: HTMLElement | null = null;
  private endTarget = false;
  private endAnchorEdge: DocumentEndAnchorEdge = "top";
  private reparentLevel: number | null = null;
  private startX = 0;
  private startY = 0;
  private moved = false;
  private activePointerId: number | null = null;
  private finishing = false;

  constructor(private readonly view: EditorView) {
    this.host = view.dom.parentElement!;
    this.handle = document.createElement("button");
    this.handle.type = "button";
    this.handle.tabIndex = -1;
    this.handle.className = "block-drag-handle";
    this.handle.dataset.editorControl = "true";
    this.handle.title = t("dragRow");
    this.handle.setAttribute("aria-label", t("dragRow"));
    this.handle.setAttribute("contenteditable", "false");
    this.handle.append(createLucideElement(GripVertical, {
      class: "lucide-icon",
      "aria-hidden": "true",
    }));
    this.highlight = document.createElement("div");
    this.highlight.className = "block-row-handle-highlight";
    this.indicator = document.createElement("div");
    this.indicator.className = "block-drop-indicator";
    this.insideIndicator = document.createElement("div");
    this.insideIndicator.className = "block-drop-inside-indicator";
    this.preview = document.createElement("div");
    this.preview.className = "block-drag-preview";
    this.preview.setAttribute("aria-hidden", "true");
    const previewHandle = createLucideElement(GripVertical, {
      class: "lucide-icon block-drag-preview-handle",
      "aria-hidden": "true",
    });
    this.previewText = document.createElement("span");
    this.previewText.className = "block-drag-preview-text";
    this.previewMeta = document.createElement("span");
    this.previewMeta.className = "block-drag-preview-meta";
    this.preview.append(previewHandle, this.previewText, this.previewMeta);
    this.deleteTarget = document.createElement("div");
    this.deleteTarget.className = "block-delete-target";
    this.deleteTarget.setAttribute("aria-hidden", "true");
    this.deleteTarget.append(createLucideElement(Trash2, {
      class: "lucide-icon",
      "aria-hidden": "true",
    }));
    const deleteLabel = document.createElement("span");
    deleteLabel.textContent = t("releaseToDelete");
    this.deleteTarget.append(deleteLabel);
    this.host.append(
      this.highlight,
      this.handle,
      this.indicator,
      this.insideIndicator,
      this.preview,
      this.deleteTarget,
    );

    this.host.addEventListener("pointermove", this.onHoverMove);
    this.host.addEventListener("pointerleave", this.onHoverLeave);
    this.host.addEventListener("scroll", this.onScroll, { passive: true });
    this.view.dom.addEventListener(FOLD_HOVER_EVENT, this.onFoldHover);
    this.handle.addEventListener("pointerenter", this.onHandleEnter);
    this.handle.addEventListener("pointerleave", this.onHandleLeave);
    this.handle.addEventListener("pointerdown", this.onDragStart);
    this.handle.addEventListener("wheel", this.onHandleWheel, { passive: false });
    this.handle.addEventListener("lostpointercapture", this.onLostPointerCapture);
  }

  update(): void {
    if (this.source) return;
    if (this.foldHovered) {
      if (!this.foldHovered.header.isConnected) {
        this.foldHovered = null;
        this.highlight.classList.remove("visible");
      } else {
        this.positionFoldHighlight(this.foldHovered);
        return;
      }
    }
    if (!this.hovered?.header.isConnected) {
      this.hide();
      return;
    }
    this.positionHandle(this.hovered);
    if (this.highlight.classList.contains("visible")) this.positionHighlight(this.hovered);
  }

  destroy(): void {
    this.clearHovered();
    window.removeEventListener("pointermove", this.onDragMove, true);
    window.removeEventListener("pointerup", this.onDragEnd, true);
    window.removeEventListener("pointercancel", this.onDragCancel, true);
    window.removeEventListener("blur", this.onWindowBlur);
    window.removeEventListener("keydown", this.onWindowKeyDown, true);
    this.host.removeEventListener("pointermove", this.onHoverMove);
    this.host.removeEventListener("pointerleave", this.onHoverLeave);
    this.host.removeEventListener("scroll", this.onScroll);
    this.view.dom.removeEventListener(FOLD_HOVER_EVENT, this.onFoldHover);
    this.handle.removeEventListener("pointerenter", this.onHandleEnter);
    this.handle.removeEventListener("pointerleave", this.onHandleLeave);
    this.handle.removeEventListener("pointerdown", this.onDragStart);
    this.handle.removeEventListener("wheel", this.onHandleWheel);
    this.handle.removeEventListener("lostpointercapture", this.onLostPointerCapture);
    this.highlight.remove();
    this.handle.remove();
    this.indicator.remove();
    this.insideIndicator.remove();
    this.preview.remove();
    this.deleteTarget.remove();
  }

  private readonly onHoverMove = (event: PointerEvent): void => {
    if (this.source) return;
    if (event.target instanceof Node && this.handle.contains(event.target)) return;
    if (this.terminalEmptyTailAt(event.clientX, event.clientY)) {
      this.hide();
      return;
    }
    const row = rowAt(this.view, event.clientX, event.clientY);
    if (!row) {
      this.hide();
      return;
    }
    this.show(row);
  };

  private readonly onHoverLeave = (event: PointerEvent): void => {
    if (!this.source && event.relatedTarget !== this.handle) this.hide();
  };

  private readonly onScroll = (): void => {
    if (this.source) {
      this.positionHandle(this.source);
      this.positionHighlight(this.source);
      if (this.target && this.reparentLevel !== null) {
        this.positionReparentTarget(this.target, this.reparentLevel);
      } else if (this.endTarget && this.visualAnchor) {
        this.positionDocumentEndTarget(this.visualAnchor, this.endAnchorEdge);
      } else {
        this.positionDropTarget(this.target, this.side, this.visualAnchor);
      }
    } else if (this.foldHovered) {
      this.positionFoldHighlight(this.foldHovered);
    } else if (this.hovered) {
      this.positionHandle(this.hovered);
      if (this.highlight.classList.contains("visible")) this.positionHighlight(this.hovered);
    }
  };

  private readonly onFoldHover = (event: Event): void => {
    if (this.source) return;
    const { position, visible } = (event as CustomEvent<FoldHoverDetail>).detail;
    if (!visible) {
      this.foldHovered = null;
      this.highlight.classList.remove("visible");
      return;
    }
    const row = rowAtPosition(this.view, position);
    if (!row) return;
    if (row.node.attrs.collapsed) {
      this.foldHovered = null;
      this.highlight.classList.remove("visible");
      return;
    }
    this.foldHovered = row;
    this.positionFoldHighlight(row);
    this.highlight.classList.add("visible");
  };

  private readonly onHandleEnter = (): void => {
    if (!this.hovered) return;
    this.positionHighlight(this.hovered);
    this.highlight.classList.add("visible");
  };

  private readonly onHandleLeave = (): void => {
    if (!this.source) this.highlight.classList.remove("visible");
  };

  private readonly onDragStart = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.hovered) return;
    event.preventDefault();
    event.stopPropagation();
    this.source = this.hovered;
    this.activePointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.moved = false;
    this.positionHighlight(this.source);
    this.highlight.classList.add("visible");
    this.showPreview(this.source, event.clientX, event.clientY);
    this.handle.classList.add("is-dragging");
    try {
      this.handle.setPointerCapture(event.pointerId);
    } catch {
      // Window-level events still provide a safe drag path when capture is unavailable.
    }
    window.addEventListener("pointermove", this.onDragMove, true);
    window.addEventListener("pointerup", this.onDragEnd, true);
    window.addEventListener("pointercancel", this.onDragCancel, true);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("keydown", this.onWindowKeyDown, true);
  };

  private readonly onDragMove = (event: PointerEvent): void => {
    if (!this.source) return;
    this.positionPreview(event.clientX, event.clientY);
    if (Math.hypot(event.clientX - this.startX, event.clientY - this.startY) >= 4) {
      this.moved = true;
    }
    this.updateDeleteTarget(event.clientX, event.clientY);
    if (this.deleteTarget.classList.contains("is-armed")) {
      this.positionDropTarget(null, "after");
      return;
    }
    autoScrollForPointer(this.host, event.clientY);

    const terminalEmptyTail = this.terminalEmptyTailAt(event.clientX, event.clientY);
    if (terminalEmptyTail) {
      const terminalRow = rowAtPosition(this.view, terminalEmptyTail.rowPosition);
      this.positionDropTarget(terminalRow, "after", terminalEmptyTail.element);
      return;
    }

    const insertTarget = this.rowInsertTarget(event.clientX, event.clientY);
    if (insertTarget) {
      if (insertTarget.position >= this.view.state.doc.content.size) {
        this.positionDocumentEndTarget(insertTarget.button);
      } else {
        const insertRow = rowAtPosition(this.view, insertTarget.position);
        if (insertRow?.node.type === noteSchema.nodes.heading) {
          this.positionDropTarget(insertRow, "before", insertTarget.button);
        } else {
          this.positionDropTarget(null, "after");
        }
      }
      return;
    }

    let row = rowAt(this.view, event.clientX, event.clientY);
    if (row?.node === this.source.node) {
      const reparent = this.reparentTarget(event.clientX, event.clientY);
      if (reparent) {
        this.positionReparentTarget(reparent.row, reparent.desiredLevel);
      } else {
        this.positionDropTarget(null, "after");
      }
      return;
    }
    if (!row) {
      const endAnchor = this.documentEndAnchor(event.clientX, event.clientY);
      if (endAnchor) {
        this.positionDocumentEndTarget(endAnchor, "bottom");
        return;
      }
      this.positionDropTarget(null, "after");
      return;
    }
    const sourcePath = findNodePath(this.view.state.doc, this.source.node);
    const targetPath = findNodePath(this.view.state.doc, row.node);
    if (sourcePath && targetPath && pathIsWithinDraggedBlock(
      this.view.state.doc,
      sourcePath,
      targetPath,
    )) {
      this.positionDropTarget(null, "after");
      return;
    }
    if (
      sourcePath
      && targetPath
      && this.source.node.type === noteSchema.nodes.heading
      && row.node.type !== noteSchema.nodes.heading
    ) {
      const ownerIndex = headingOwnerIndex(this.view.state.doc, targetPath);
      if (ownerIndex !== null) {
        row = rowAtPosition(
          this.view,
          topLevelNodePosition(this.view.state.doc, ownerIndex),
        );
        if (!row) {
          this.positionDropTarget(null, "after");
          return;
        }
        this.positionDropTarget(row, "after", row.header);
        return;
      }
    }
    const headerRect = rowHeaderVerticalRect(row.header);
    const lineHeight = Number.parseFloat(getComputedStyle(row.header).lineHeight) || 21;
    let side: RowDropSide;
    if (
      this.source.node.type !== noteSchema.nodes.heading
      && (row.node.type === noteSchema.nodes.list_item
        || row.node.type === noteSchema.nodes.heading)
    ) {
      const hitHeight = Math.max(lineHeight, headerRect.bottom - headerRect.top);
      const relativeY = (event.clientY - headerRect.top) / hitHeight;
      side = relativeY < 0.25 ? "before" : relativeY > 0.75 ? "after" : "inside";
    } else {
      side = event.clientY < headerRect.top + lineHeight / 2 ? "before" : "after";
    }
    this.positionDropTarget(row, side, row.header);
  };

  private readonly onHandleWheel = (event: WheelEvent): void => {
    if (event.deltaY === 0) return;
    scrollForWheel(this.host, event.deltaY, event.deltaMode);
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly onDragEnd = (event: PointerEvent): void => {
    const sourcePosition = this.source?.position;
    const sourceNode = this.source?.node ?? null;
    const targetPosition = this.target?.position;
    const targetNode = this.target?.node ?? null;
    const side = this.side;
    const movesToEnd = this.endTarget;
    const pointerX = event.clientX;
    const pointerY = event.clientY;
    this.updateDeleteTarget(pointerX, pointerY);
    const shouldDelete = sourcePosition !== undefined
      && this.moved
      && this.deleteTarget.classList.contains("is-armed");
    const shouldMove = sourcePosition !== undefined
      && (targetPosition !== undefined || movesToEnd)
      && this.moved
      && !shouldDelete;

    // End pointer capture before changing the editor DOM. WebView otherwise may
    // reconcile the old native caret after ProseMirror has rendered the move.
    this.finishDrag(event.pointerId);
    if (shouldDelete) {
      preserveViewportDuring(this.host, () => {
        deleteRow(this.view.state, this.view.dispatch, sourcePosition);
      });
    } else if (shouldMove) {
      const moved = movesToEnd
        ? moveRowToDocumentEnd(this.view.state, this.view.dispatch, sourcePosition)
        : moveRow(
          this.view.state,
          this.view.dispatch,
          sourcePosition,
          targetPosition!,
          side,
        );
      if (moved && sourceNode) {
        alignDocumentBoundary(
          this.host,
          () => this.dropBoundary(sourceNode, targetNode, side, movesToEnd),
          pointerY,
        );
      }
    }

    const hostRect = this.host.getBoundingClientRect();
    if (
      pointerX >= hostRect.left
      && pointerX <= hostRect.right
      && pointerY >= hostRect.top
      && pointerY <= hostRect.bottom
    ) {
      if (!this.terminalEmptyTailAt(pointerX, pointerY)) {
        const row = rowAt(this.view, pointerX, pointerY);
        if (row) this.show(row);
      }
    }
  };

  private readonly onDragCancel = (event: PointerEvent): void => {
    this.finishDrag(event.pointerId);
  };

  private readonly onLostPointerCapture = (): void => {
    if (this.source && !this.finishing) this.finishDrag();
  };

  private readonly onWindowBlur = (): void => {
    if (this.source) this.finishDrag();
  };

  private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.source) this.finishDrag();
  };

  private finishDrag(pointerId: number | null = this.activePointerId): void {
    if (this.finishing) return;
    this.finishing = true;
    try {
      this.handle.classList.remove("is-dragging");
      window.removeEventListener("pointermove", this.onDragMove, true);
      window.removeEventListener("pointerup", this.onDragEnd, true);
      window.removeEventListener("pointercancel", this.onDragCancel, true);
      window.removeEventListener("blur", this.onWindowBlur);
      window.removeEventListener("keydown", this.onWindowKeyDown, true);
      if (pointerId !== null && this.handle.hasPointerCapture(pointerId)) {
        try {
          this.handle.releasePointerCapture(pointerId);
        } catch {
          // Capture may already have been released by the WebView.
        }
      }
    } finally {
      this.activePointerId = null;
      this.source = null;
      this.target = null;
      this.visualAnchor = null;
      this.endTarget = false;
      this.endAnchorEdge = "top";
      this.reparentLevel = null;
      this.indicator.classList.remove("visible");
      this.insideIndicator.classList.remove("visible");
      this.deleteTarget.classList.remove("visible", "is-armed");
      this.preview.classList.remove("visible");
      this.highlight.classList.remove("visible");
      this.hide();
      this.finishing = false;
    }
  }

  private show(row: RowDescriptor): void {
    if (this.hovered?.node !== row.node) {
      this.clearHovered();
      this.hovered = row;
    } else {
      this.hovered = row;
    }
    this.positionHandle(row);
  }

  private hide(): void {
    this.clearHovered();
    this.handle.classList.remove("visible");
  }

  private clearHovered(): void {
    if (!this.foldHovered) this.highlight.classList.remove("visible");
    this.hovered = null;
  }

  private positionHandle(row: RowDescriptor): void {
    const hostRect = this.host.getBoundingClientRect();
    const headerRect = rowHeaderVerticalRect(row.header);
    const lineHeight = Number.parseFloat(getComputedStyle(row.header).lineHeight) || 21;
    this.handle.style.left = `${hostRect.left + 3}px`;
    this.handle.style.top = `${headerRect.top + Math.max(0, (lineHeight - 22) / 2)}px`;
    if (headerRect.bottom < hostRect.top || headerRect.top > hostRect.bottom) {
      this.handle.classList.remove("visible");
      this.highlight.classList.remove("visible");
      return;
    }
    this.handle.classList.add("visible");
    if (this.source) this.highlight.classList.add("visible");
  }

  private showPreview(row: RowDescriptor, clientX: number, clientY: number): void {
    const path = findNodePath(this.view.state.doc, row.node);
    const count = path ? draggedRowCount(this.view.state.doc, path) : 1;
    const text = row.header.textContent?.trim() || t("dragPreviewEmpty");
    this.previewText.textContent = text;
    this.previewText.style.width = "";
    if (row.node.type === noteSchema.nodes.heading) {
      this.previewMeta.textContent = t("dragPreviewSection", { count });
    } else if (count > 1) {
      this.previewMeta.textContent = t("dragPreviewItems", { count });
    } else {
      this.previewMeta.textContent = "";
    }
    this.preview.classList.add("visible");
    this.truncatePreviewText(text);
    this.positionPreview(clientX, clientY);
  }

  private truncatePreviewText(text: string): void {
    const availableWidth = this.previewText.clientWidth;
    if (availableWidth <= 0 || this.previewText.scrollWidth <= availableWidth) return;

    this.previewText.style.width = `${availableWidth}px`;
    const characters = Array.from(text);
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const length = Math.ceil((low + high) / 2);
      this.previewText.textContent = `${characters.slice(0, length).join("")}...`;
      if (this.previewText.scrollWidth <= availableWidth) low = length;
      else high = length - 1;
    }
    this.previewText.textContent = `${characters.slice(0, low).join("")}...`;
  }

  private positionPreview(clientX: number, clientY: number): void {
    this.preview.style.left = `${clientX - 4}px`;
    this.preview.style.top = `${clientY - 18}px`;
  }

  private positionHighlight(row: RowDescriptor): void {
    const hostRect = this.host.getBoundingClientRect();
    const blockRect = draggedBlockVerticalRect(this.view, row);
    const left = hostRect.left + 3;
    const top = Math.max(hostRect.top, blockRect.top - 2);
    const bottom = Math.min(hostRect.bottom, blockRect.bottom + 2);
    this.highlight.style.left = `${left}px`;
    this.highlight.style.top = `${top}px`;
    this.highlight.style.width = `${Math.max(24, hostRect.right - left - 12)}px`;
    this.highlight.style.height = `${Math.max(0, bottom - top)}px`;
  }

  private positionFoldHighlight(row: RowDescriptor): void {
    const hostRect = this.host.getBoundingClientRect();
    const headerRect = rowHeaderVerticalRect(row.header);
    const blockRect = draggedBlockVerticalRect(this.view, row);
    const left = hostRect.left + 3;
    const top = Math.max(hostRect.top, headerRect.bottom - 2);
    const right = Math.min(hostRect.right - 12, row.header.getBoundingClientRect().right);
    const bottom = Math.min(hostRect.bottom, blockRect.bottom + 2);
    this.highlight.style.left = `${left}px`;
    this.highlight.style.top = `${top}px`;
    this.highlight.style.width = `${Math.max(24, right - left)}px`;
    this.highlight.style.height = `${Math.max(0, bottom - top)}px`;
  }

  private positionDropTarget(
    row: RowDescriptor | null,
    side: RowDropSide,
    visualAnchor: HTMLElement | null = row?.header ?? null,
  ): void {
    const effectiveVisualAnchor = row?.node.type === noteSchema.nodes.heading
      && side === "before"
      ? this.headingInsertButton(row) ?? visualAnchor
      : visualAnchor;
    this.target = row;
    this.side = side;
    this.visualAnchor = effectiveVisualAnchor;
    this.endTarget = false;
    this.endAnchorEdge = "top";
    this.reparentLevel = null;
    this.indicator.classList.remove("visible");
    this.insideIndicator.classList.remove("visible");
    if (!row) {
      return;
    }
    if (
      this.source
      && !moveRow(
        this.view.state,
        undefined,
        this.source.position,
        row.position,
        side,
      )
    ) {
      this.target = null;
      return;
    }
    const hostRect = this.host.getBoundingClientRect();
    const headerBounds = row.header.getBoundingClientRect();
    const rowBounds = row.dom.getBoundingClientRect();
    const headerRect = rowHeaderVerticalRect(row.header);
    if (side === "inside") {
      const contentLeft = row.node.type === noteSchema.nodes.list_item
        ? this.listFeedbackLeft(row)
        : Math.min(rowBounds.left, headerBounds.left) - 8;
      const left = Math.max(hostRect.left + 3, contentLeft);
      const top = Math.max(hostRect.top, headerRect.top - 3);
      const right = hostRect.right - 12;
      const bottom = Math.min(
        hostRect.bottom,
        draggedBlockVerticalRect(this.view, row).bottom + 3,
      );
      this.insideIndicator.style.left = `${left}px`;
      this.insideIndicator.style.top = `${top}px`;
      this.insideIndicator.style.width = `${Math.max(24, right - left)}px`;
      this.insideIndicator.style.height = `${Math.max(0, bottom - top)}px`;
      this.insideIndicator.classList.add("visible");
      return;
    }
    const visualRect = effectiveVisualAnchor === row.header
      ? rowHeaderVerticalRect(row.header)
      : unshiftedVerticalRect(effectiveVisualAnchor ?? row.header);
    const top = side === "before"
      ? visualRect.top
      : this.source?.node.type === noteSchema.nodes.heading
        && row.node.type === noteSchema.nodes.heading
        ? draggedBlockVerticalRect(this.view, row).bottom
        : visualRect.bottom;
    const left = this.dropIndicatorLeft(row);
    this.indicator.style.left = `${left}px`;
    this.indicator.style.top = `${top - 1}px`;
    this.indicator.style.width = `${Math.max(24, hostRect.right - left - 12)}px`;
    this.indicator.classList.add("visible");
  }

  private headingInsertButton(row: RowDescriptor): HTMLElement | null {
    const previous = row.dom.previousElementSibling;
    return previous instanceof HTMLElement
      && previous.classList.contains("row-insert-button")
      ? previous
      : null;
  }

  private rowInsertTarget(
    clientX: number,
    clientY: number,
  ): { button: HTMLElement; position: number } | null {
    const hostRect = this.host.getBoundingClientRect();
    const buttons = Array.from(
      this.view.dom.querySelectorAll<HTMLElement>(".row-insert-button"),
    );
    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      const terminal = button.classList.contains("is-terminal");
      const horizontalHit = clientX >= hostRect.left && clientX <= hostRect.right;
      const verticalHit = terminal
        ? clientY >= rect.top && clientY <= hostRect.bottom
        : clientY >= rect.top && clientY <= rect.bottom;
      if (!horizontalHit || !verticalHit) continue;
      try {
        return { button, position: this.view.posAtDOM(button, 0) };
      } catch {
        return null;
      }
    }
    return null;
  }

  private dropIndicatorLeft(row: RowDescriptor | null): number {
    const editorRect = this.view.dom.getBoundingClientRect();
    const sourceRow = this.source;
    const source = sourceRow?.node;
    if (!source) return editorRect.left;
    if (source.type === noteSchema.nodes.heading) return editorRect.left;
    if (row?.node.type === noteSchema.nodes.list_item) {
      return this.listFeedbackLeft(row);
    }
    if (source.type === noteSchema.nodes.list_item) {
      return editorRect.left;
    }
    return editorRect.left;
  }

  private listFeedbackLeft(row: RowDescriptor): number {
    const list = row.dom.parentElement;
    if (list instanceof HTMLElement && (list.tagName === "UL" || list.tagName === "OL")) {
      const listBounds = list.getBoundingClientRect();
      if (listBounds.width > 0) return listBounds.left;
    }
    const headerLeft = row.header.getBoundingClientRect().left;
    const fontSize = Number.parseFloat(getComputedStyle(row.header).fontSize) || 16;
    return headerLeft - fontSize * 1.9;
  }

  private dropBoundary(
    source: ProseMirrorNode,
    target: ProseMirrorNode | null,
    side: RowDropSide,
    documentEnd: boolean,
  ): number | null {
    const movedPath = findNodePath(this.view.state.doc, source);
    if (movedPath) {
      const movedRow = rowAtPosition(
        this.view,
        nodePositionAtPath(this.view.state.doc, movedPath),
      );
      if (movedRow) return unshiftedVerticalRect(movedRow.header).top;
    }
    if (documentEnd) {
      return null;
    }
    if (!target) return null;
    const targetPath = findNodePath(this.view.state.doc, target);
    if (!targetPath) return null;
    const row = rowAtPosition(
      this.view,
      nodePositionAtPath(this.view.state.doc, targetPath),
    );
    if (!row) return null;
    if (side === "before") return unshiftedVerticalRect(row.header).top;
    if (side === "inside") return draggedBlockVerticalRect(this.view, row).bottom;
    if (
      source.type === noteSchema.nodes.heading
      && target.type === noteSchema.nodes.list_item
      && targetPath.length > 2
    ) {
      const topLevelDom = this.view.nodeDOM(
        topLevelNodePosition(this.view.state.doc, targetPath[0]!),
      );
      return topLevelDom instanceof HTMLElement
        ? unshiftedVerticalRect(topLevelDom).bottom
        : null;
    }
    if (
      target.type === noteSchema.nodes.list_item
      || (source.type === noteSchema.nodes.heading
        && target.type === noteSchema.nodes.heading)
    ) {
      return draggedBlockVerticalRect(this.view, row).bottom;
    }
    return unshiftedVerticalRect(row.header).bottom;
  }

  private positionDocumentEndTarget(
    anchor: HTMLElement,
    edge: DocumentEndAnchorEdge = "top",
  ): void {
    this.target = null;
    this.side = "after";
    this.visualAnchor = anchor;
    this.endTarget = true;
    this.endAnchorEdge = edge;
    this.reparentLevel = null;
    this.indicator.classList.remove("visible");
    this.insideIndicator.classList.remove("visible");
    if (!this.source || !moveRowToDocumentEnd(
      this.view.state,
      undefined,
      this.source.position,
    )) return;
    const hostRect = this.host.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const top = edge === "top" ? anchorRect.top : anchorRect.bottom;
    const left = this.dropIndicatorLeft(null);
    this.indicator.style.left = `${left}px`;
    this.indicator.style.top = `${top - 1}px`;
    this.indicator.style.width = `${Math.max(24, hostRect.right - left - 12)}px`;
    this.indicator.classList.add("visible");
  }

  private terminalEmptyTailAt(clientX: number, clientY: number): TerminalEmptyTail | null {
    const hostRect = this.host.getBoundingClientRect();
    if (clientX < hostRect.left || clientX > hostRect.right) return null;
    const terminalEmptyLine = this.view.dom.querySelector<HTMLElement>(
      ".is-terminal-empty-line",
    );
    if (!terminalEmptyLine) return null;
    const lineRect = rowHeaderVerticalRect(terminalEmptyLine);
    if (clientY < lineRect.bottom) return null;
    const terminalBlank = terminalBlankTextblock(this.view.state.doc);
    const rowPosition = terminalBlank
      ? rowPositionAt(this.view, terminalBlank.from + 1)
      : null;
    return rowPosition === null ? null : { element: terminalEmptyLine, rowPosition };
  }

  private documentEndAnchor(clientX: number, clientY: number): HTMLElement | null {
    const hostRect = this.host.getBoundingClientRect();
    if (clientX < hostRect.left || clientX > hostRect.right) return null;
    const children = Array.from(this.view.dom.children).reverse();
    for (const child of children) {
      if (!(child instanceof HTMLElement) || child.classList.contains("row-insert-button")) {
        continue;
      }
      const rect = child.getBoundingClientRect();
      if (rect.height <= 0) continue;
      return clientY >= rect.bottom ? child : null;
    }
    return null;
  }

  private reparentTarget(
    clientX: number,
    clientY: number,
  ): { row: RowDescriptor; desiredLevel: number } | null {
    if (!this.source || this.source.node.type !== noteSchema.nodes.list_item) return null;
    const sourcePath = findNodePath(this.view.state.doc, this.source.node);
    if (!sourcePath) return null;
    const parentList = nodeAtPath(this.view.state.doc, sourcePath.slice(0, -1));
    const sourceIndex = sourcePath[sourcePath.length - 1]!;
    if (sourceIndex !== parentList.childCount - 1) return null;

    const ancestorPaths = listItemAncestorPaths(this.view.state.doc, sourcePath);
    const currentLevel = ancestorPaths.length - 1;
    if (currentLevel <= 0) return null;
    const sourceBounds = this.source.header.getBoundingClientRect();
    if (clientY < (sourceBounds.top + sourceBounds.bottom) / 2) return null;

    const parentPath = ancestorPaths[currentLevel - 1]!;
    const parentRow = rowAtPosition(
      this.view,
      nodePositionAtPath(this.view.state.doc, parentPath),
    );
    if (!parentRow) return null;
    const measuredIndent = sourceBounds.left - parentRow.header.getBoundingClientRect().left;
    const fontSize = Number.parseFloat(getComputedStyle(this.view.dom).fontSize) || 16;
    const indentPerLevel = measuredIndent > 0 ? measuredIndent : fontSize * 1.9;
    const baseLeft = sourceBounds.left - currentLevel * indentPerLevel;
    if (clientX >= baseLeft + currentLevel * indentPerLevel) return null;

    const desiredLevel = Math.max(Math.floor((clientX - baseLeft) / indentPerLevel), 0);
    if (desiredLevel >= currentLevel) return null;
    const targetPath = ancestorPaths[desiredLevel]!;
    const row = rowAtPosition(
      this.view,
      nodePositionAtPath(this.view.state.doc, targetPath),
    );
    return row ? { row, desiredLevel } : null;
  }

  private positionReparentTarget(row: RowDescriptor, desiredLevel: number): void {
    this.positionDropTarget(row, "after");
    if (!this.source) return;
    const hostRect = this.host.getBoundingClientRect();
    const left = this.listFeedbackLeft(row);
    const top = unshiftedVerticalRect(this.source.header).bottom;
    this.indicator.style.left = `${left}px`;
    this.indicator.style.top = `${top - 1}px`;
    this.indicator.style.width = `${Math.max(24, hostRect.right - left - 12)}px`;
    this.indicator.classList.add("visible");
    this.reparentLevel = desiredLevel;
  }

  private updateDeleteTarget(clientX: number, clientY: number): void {
    if (!this.moved) {
      this.deleteTarget.classList.remove("visible", "is-armed");
      return;
    }
    this.deleteTarget.classList.add("visible");
    const bounds = this.deleteTarget.getBoundingClientRect();
    this.deleteTarget.classList.toggle(
      "is-armed",
      clientX >= bounds.left - DELETE_TARGET_HIT_PADDING
        && clientX <= bounds.right + DELETE_TARGET_HIT_PADDING
        && clientY >= bounds.top - DELETE_TARGET_HIT_PADDING
        && clientY <= bounds.bottom + DELETE_TARGET_HIT_PADDING,
    );
  }
}

export function rowDragPlugin(): Plugin {
  return new Plugin({
    view: (view) => new RowDragHandleView(view),
  });
}
