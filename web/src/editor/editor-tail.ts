import { type Node as ProseMirrorNode } from "prosemirror-model";
import { type EditorView } from "prosemirror-view";

import { noteSchema } from "./schema";

export const DOCUMENT_END_ZONE_CLASS = "document-end-zone";

type DocumentTailDescription =
  | { kind: "blank"; terminalBlankNodePosition: number }
  | { kind: "collapsed-heading"; collapsedHeadingPosition: number }
  | { kind: "insert" };

type DocumentTailTarget =
  | { kind: "blank"; element: HTMLElement; terminalBlankSelectionPosition: number }
  | { kind: "collapsed-heading"; element: HTMLElement; collapsedHeadingPosition: number }
  | { kind: "insert"; element: HTMLElement };

const documentTailCache = new WeakMap<ProseMirrorNode, DocumentTailDescription>();

function terminalBlankPosition(doc: ProseMirrorNode): number | null {
  let lastPosition = -1;
  let lastIsBlank = false;
  doc.descendants((node, position) => {
    if (node.isTextblock) {
      lastPosition = position;
      lastIsBlank = node.content.size === 0;
    }
  });
  return lastIsBlank ? lastPosition : null;
}

function finalCollapsedHeadingPosition(doc: ProseMirrorNode): number | null {
  let position = 0;
  let finalHeading: { position: number; collapsed: boolean; hasContent: boolean } | null = null;
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    if (node.type === noteSchema.nodes.heading) {
      finalHeading = {
        position,
        collapsed: Boolean(node.attrs.collapsed),
        hasContent: index < doc.childCount - 1,
      };
    }
    position += node.nodeSize;
  }
  return finalHeading?.collapsed && finalHeading.hasContent
    ? finalHeading.position
    : null;
}

export function describeDocumentTail(doc: ProseMirrorNode): DocumentTailDescription {
  const cached = documentTailCache.get(doc);
  if (cached) return cached;
  const terminalBlank = terminalBlankPosition(doc);
  const collapsedHeading = finalCollapsedHeadingPosition(doc);
  const tail: DocumentTailDescription = collapsedHeading !== null
    ? { kind: "collapsed-heading", collapsedHeadingPosition: collapsedHeading }
    : terminalBlank !== null
      ? { kind: "blank", terminalBlankNodePosition: terminalBlank }
      : { kind: "insert" };
  documentTailCache.set(doc, tail);
  return tail;
}

export function documentTailAt(
  view: EditorView,
  host: HTMLElement,
  clientX: number,
  clientY: number,
): DocumentTailTarget | null {
  const hostRect = host.getBoundingClientRect();
  if (
    clientX < hostRect.left
    || clientX > hostRect.right
    || clientY < hostRect.top
  ) return null;

  const element = view.dom.querySelector<HTMLElement>(`.${DOCUMENT_END_ZONE_CLASS}`);
  if (!element) return null;
  const zoneRect = element.getBoundingClientRect();
  if (zoneRect.height <= 0 || clientY < zoneRect.top) return null;

  const tail = describeDocumentTail(view.state.doc);
  if (tail.kind === "blank") {
    return {
      kind: "blank",
      element,
      terminalBlankSelectionPosition: tail.terminalBlankNodePosition + 1,
    };
  }
  return tail.kind === "collapsed-heading"
    ? {
        kind: "collapsed-heading",
        element,
        collapsedHeadingPosition: tail.collapsedHeadingPosition,
      }
    : { kind: "insert", element };
}
