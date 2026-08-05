import createLucideElement from "lucide/dist/esm/createElement.mjs";
import GripVertical from "lucide/dist/esm/icons/grip-vertical.mjs";
import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { type EditorView } from "prosemirror-view";

import { normalizeListDocument } from "./list-normalization";
import { noteSchema } from "./schema";
import { t } from "../i18n";

export type RowDropSide = "before" | "after";

type ListKind = "bullet" | "ordered" | "task";

interface RowDescriptor {
  node: ProseMirrorNode;
  position: number;
  dom: HTMLElement;
  header: HTMLElement;
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

function listItemKind(list: ProseMirrorNode, item: ProseMirrorNode): ListKind {
  if (list.type === noteSchema.nodes.ordered_list) return "ordered";
  return typeof item.attrs.checked === "boolean" ? "task" : "bullet";
}

function listItemForKind(
  source: ProseMirrorNode,
  kind: ListKind,
  sourceKind: ListKind | null,
): ProseMirrorNode {
  const content = source.type === noteSchema.nodes.list_item
    ? source.content
    : source;
  const checked = kind === "task"
    ? sourceKind === "task" ? Boolean(source.attrs.checked) : false
    : null;
  return noteSchema.nodes.list_item.create({ checked }, content);
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
  const target = state.doc.nodeAt(targetPosition);
  if (!source || !target || source === target) return false;

  const sourcePath = findNodePath(state.doc, source);
  const targetPath = findNodePath(state.doc, target);
  if (
    !sourcePath
    || !targetPath
    || !isDraggableRowAtPath(state.doc, sourcePath)
    || !isDraggableRowAtPath(state.doc, targetPath)
    || pathStartsWith(targetPath, sourcePath)
  ) {
    return false;
  }

  let sourceKind: ListKind | null = null;
  if (source.type === noteSchema.nodes.list_item) {
    sourceKind = listItemKind(nodeAtPath(state.doc, sourcePath.slice(0, -1)), source);
  }
  const sourceIsHeading = source.type === noteSchema.nodes.heading;

  let nextDoc = removeRowAtPath(state.doc, sourcePath);
  const nextTargetPath = findNodePath(nextDoc, target);
  if (!nextTargetPath) return false;

  let selectedNode: ProseMirrorNode;
  if (target.type === noteSchema.nodes.list_item) {
    const listPath = nextTargetPath.slice(0, -1);
    const list = nodeAtPath(nextDoc, listPath);
    const targetIndex = nextTargetPath[nextTargetPath.length - 1]!;
    const insertionIndex = targetIndex + (side === "after" ? 1 : 0);
    if (sourceIsHeading && listPath.length === 1) {
      const listChildren: ProseMirrorNode[] = [];
      list.forEach((child) => listChildren.push(child));
      const replacements: ProseMirrorNode[] = [];
      if (insertionIndex > 0) {
        replacements.push(copyWithChildren(list, listChildren.slice(0, insertionIndex)));
      }
      selectedNode = source;
      replacements.push(source);
      if (insertionIndex < list.childCount) {
        replacements.push(copyWithChildren(list, listChildren.slice(insertionIndex)));
      }
      nextDoc = replaceNodeAtPathWithNodes(nextDoc, listPath, replacements);
    } else if (sourceIsHeading) {
      selectedNode = source;
      const topLevelIndex = nextTargetPath[0]!;
      nextDoc = insertNodeAtPath(
        nextDoc,
        [],
        topLevelIndex + (side === "after" ? 1 : 0),
        source,
      );
    } else {
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
    const insertionIndex = targetIndex + (side === "after" ? 1 : 0);
    const previous = insertionIndex > 0 ? nextDoc.child(insertionIndex - 1) : null;
    if (sourceIsHeading) {
      selectedNode = source;
      nextDoc = insertNodeAtPath(nextDoc, [], insertionIndex, source);
    } else if (
      previous
      && (previous.type === noteSchema.nodes.bullet_list
        || previous.type === noteSchema.nodes.ordered_list)
    ) {
      const reference = previous.lastChild!;
      selectedNode = listItemForKind(
        source,
        listItemKind(previous, reference),
        sourceKind,
      );
      nextDoc = insertNodeAtPath(nextDoc, [insertionIndex - 1], previous.childCount, selectedNode);
    } else {
      const root = rootNodeForSource(source, sourceKind);
      selectedNode = root.selected;
      nextDoc = insertNodeAtPath(nextDoc, [], insertionIndex, root.node);
    }
  }

  nextDoc = normalizeListDocument(nextDoc);
  if (nextDoc.eq(state.doc)) return false;
  if (!dispatch) return true;

  let prefixCount = 0;
  while (
    prefixCount < state.doc.childCount
    && prefixCount < nextDoc.childCount
    && state.doc.child(prefixCount).eq(nextDoc.child(prefixCount))
  ) {
    prefixCount += 1;
  }

  let suffixCount = 0;
  while (
    suffixCount < state.doc.childCount - prefixCount
    && suffixCount < nextDoc.childCount - prefixCount
    && state.doc.child(state.doc.childCount - suffixCount - 1)
      .eq(nextDoc.child(nextDoc.childCount - suffixCount - 1))
  ) {
    suffixCount += 1;
  }

  let changedFrom = 0;
  for (let index = 0; index < prefixCount; index += 1) {
    changedFrom += state.doc.child(index).nodeSize;
  }
  let oldChangedTo = state.doc.content.size;
  let newChangedTo = nextDoc.content.size;
  for (let index = 0; index < suffixCount; index += 1) {
    oldChangedTo -= state.doc.child(state.doc.childCount - index - 1).nodeSize;
    newChangedTo -= nextDoc.child(nextDoc.childCount - index - 1).nodeSize;
  }

  const transaction = state.tr.replace(
    changedFrom,
    oldChangedTo,
    nextDoc.slice(changedFrom, newChangedTo),
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
    const node = view.state.doc.nodeAt(position);
    const dom = view.nodeDOM(position);
    if (!node || !(dom instanceof HTMLElement)) continue;
    const header = rowHeader(dom, node);
    if (header) return { node, position, dom, header };
  }
  return null;
}

class RowDragHandleView {
  private readonly host: HTMLElement;
  private readonly handle: HTMLButtonElement;
  private readonly highlight: HTMLDivElement;
  private readonly indicator: HTMLDivElement;
  private hovered: RowDescriptor | null = null;
  private source: RowDescriptor | null = null;
  private target: RowDescriptor | null = null;
  private side: RowDropSide = "after";
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
    this.host.append(this.highlight, this.handle, this.indicator);

    this.host.addEventListener("pointermove", this.onHoverMove);
    this.host.addEventListener("pointerleave", this.onHoverLeave);
    this.host.addEventListener("scroll", this.onScroll, { passive: true });
    this.handle.addEventListener("pointerenter", this.onHandleEnter);
    this.handle.addEventListener("pointerleave", this.onHandleLeave);
    this.handle.addEventListener("pointerdown", this.onDragStart);
    this.handle.addEventListener("lostpointercapture", this.onLostPointerCapture);
  }

  update(): void {
    if (this.source) return;
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
    this.handle.removeEventListener("pointerenter", this.onHandleEnter);
    this.handle.removeEventListener("pointerleave", this.onHandleLeave);
    this.handle.removeEventListener("pointerdown", this.onDragStart);
    this.handle.removeEventListener("lostpointercapture", this.onLostPointerCapture);
    this.highlight.remove();
    this.handle.remove();
    this.indicator.remove();
  }

  private readonly onHoverMove = (event: PointerEvent): void => {
    if (this.source) return;
    if (event.target instanceof Node && this.handle.contains(event.target)) return;
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
      this.positionDropTarget(this.target, this.side);
    } else if (this.hovered) {
      this.positionHandle(this.hovered);
      if (this.highlight.classList.contains("visible")) this.positionHighlight(this.hovered);
    }
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
    if (Math.hypot(event.clientX - this.startX, event.clientY - this.startY) >= 4) {
      this.moved = true;
    }
    const hostRect = this.host.getBoundingClientRect();
    if (event.clientY < hostRect.top + 34) this.host.scrollTop -= 18;
    else if (event.clientY > hostRect.bottom - 34) this.host.scrollTop += 18;

    const row = rowAt(this.view, event.clientX, event.clientY);
    if (!row || row.node === this.source.node) {
      this.positionDropTarget(null, "after");
      return;
    }
    const sourcePath = findNodePath(this.view.state.doc, this.source.node);
    const targetPath = findNodePath(this.view.state.doc, row.node);
    if (sourcePath && targetPath && pathStartsWith(targetPath, sourcePath)) {
      this.positionDropTarget(null, "after");
      return;
    }
    const headerRect = unshiftedVerticalRect(row.header);
    const lineHeight = Number.parseFloat(getComputedStyle(row.header).lineHeight) || 21;
    const side: RowDropSide = event.clientY < headerRect.top + lineHeight / 2
      ? "before"
      : "after";
    this.positionDropTarget(row, side);
  };

  private readonly onDragEnd = (event: PointerEvent): void => {
    const sourcePosition = this.source?.position;
    const targetPosition = this.target?.position;
    const side = this.side;
    const pointerX = event.clientX;
    const pointerY = event.clientY;
    const shouldMove = sourcePosition !== undefined
      && targetPosition !== undefined
      && this.moved;

    // End pointer capture before changing the editor DOM. WebView otherwise may
    // reconcile the old native caret after ProseMirror has rendered the move.
    this.finishDrag(event.pointerId);
    if (shouldMove) {
      moveRow(
        this.view.state,
        this.view.dispatch,
        sourcePosition,
        targetPosition,
        side,
      );
    }

    const hostRect = this.host.getBoundingClientRect();
    if (
      pointerX >= hostRect.left
      && pointerX <= hostRect.right
      && pointerY >= hostRect.top
      && pointerY <= hostRect.bottom
    ) {
      const row = rowAt(this.view, pointerX, pointerY);
      if (row) this.show(row);
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
      this.indicator.classList.remove("visible");
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
    this.highlight.classList.remove("visible");
    this.hovered = null;
  }

  private positionHandle(row: RowDescriptor): void {
    const hostRect = this.host.getBoundingClientRect();
    const headerRect = unshiftedVerticalRect(row.header);
    if (headerRect.bottom < hostRect.top || headerRect.top > hostRect.bottom) {
      this.handle.classList.remove("visible");
      this.highlight.classList.remove("visible");
      return;
    }
    const lineHeight = Number.parseFloat(getComputedStyle(row.header).lineHeight) || 21;
    this.handle.style.left = `${hostRect.left + 3}px`;
    this.handle.style.top = `${headerRect.top + Math.max(0, (lineHeight - 22) / 2)}px`;
    this.handle.classList.add("visible");
  }

  private positionHighlight(row: RowDescriptor): void {
    const hostRect = this.host.getBoundingClientRect();
    const headerRect = unshiftedVerticalRect(row.header);
    const left = hostRect.left + 3;
    const top = Math.max(hostRect.top, headerRect.top - 2);
    const bottom = Math.min(hostRect.bottom, headerRect.bottom + 2);
    this.highlight.style.left = `${left}px`;
    this.highlight.style.top = `${top}px`;
    this.highlight.style.width = `${Math.max(24, hostRect.right - left - 12)}px`;
    this.highlight.style.height = `${Math.max(0, bottom - top)}px`;
  }

  private positionDropTarget(row: RowDescriptor | null, side: RowDropSide): void {
    this.target = row;
    this.side = side;
    if (!row) {
      this.indicator.classList.remove("visible");
      return;
    }
    const hostRect = this.host.getBoundingClientRect();
    const headerBounds = row.header.getBoundingClientRect();
    const headerRect = unshiftedVerticalRect(row.header);
    const rowRect = row.dom.getBoundingClientRect();
    const top = side === "before"
      ? headerRect.top
      : row.dom === row.header ? headerRect.bottom : rowRect.bottom;
    this.indicator.style.left = `${headerBounds.left}px`;
    this.indicator.style.top = `${top - 1}px`;
    this.indicator.style.width = `${Math.max(24, hostRect.right - headerBounds.left - 12)}px`;
    this.indicator.classList.add("visible");
  }
}

export function rowDragPlugin(): Plugin {
  return new Plugin({
    view: (view) => new RowDragHandleView(view),
  });
}
