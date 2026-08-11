import { type Node as ProseMirrorNode } from "prosemirror-model";
import { type EditorView } from "prosemirror-view";

import { noteSchema } from "./schema";

export const DOCUMENT_END_ZONE_CLASS = "document-end-zone";

export interface DocumentEndZone {
  element: HTMLElement;
  terminalBlankPosition: number | null;
  collapsedHeadingPosition: number | null;
}

export function terminalBlankPosition(doc: ProseMirrorNode): number | null {
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

export function finalCollapsedHeadingPosition(doc: ProseMirrorNode): number | null {
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

export function documentEndZoneAt(
  view: EditorView,
  host: HTMLElement,
  clientX: number,
  clientY: number,
): DocumentEndZone | null {
  const hostRect = host.getBoundingClientRect();
  if (
    clientX < hostRect.left
    || clientX > hostRect.right
    || clientY < hostRect.top
    || clientY > hostRect.bottom
  ) return null;

  const element = view.dom.querySelector<HTMLElement>(`.${DOCUMENT_END_ZONE_CLASS}`);
  if (!element) return null;
  const zoneRect = element.getBoundingClientRect();
  if (zoneRect.height <= 0 || clientY < zoneRect.top) return null;

  const terminalBlank = terminalBlankPosition(view.state.doc);
  return {
    element,
    terminalBlankPosition: terminalBlank === null ? null : terminalBlank + 1,
    collapsedHeadingPosition: finalCollapsedHeadingPosition(view.state.doc),
  };
}
