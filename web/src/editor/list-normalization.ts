import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, Plugin, type Transaction } from "prosemirror-state";
import { canJoin } from "prosemirror-transform";

import { noteSchema } from "./schema";

function isList(node: ProseMirrorNode): boolean {
  return node.type === noteSchema.nodes.bullet_list
    || node.type === noteSchema.nodes.ordered_list;
}

function collectAdjacentListBoundaries(
  node: ProseMirrorNode,
  contentStart: number,
  boundaries: number[],
): void {
  let previous: ProseMirrorNode | null = null;
  node.forEach((child, offset) => {
    const position = contentStart + offset;
    if (previous && isList(previous) && previous.type === child.type) {
      boundaries.push(position);
    }
    collectAdjacentListBoundaries(child, position + 1, boundaries);
    previous = child;
  });
}

export function normalizeListTransaction(state: EditorState): Transaction | null {
  const boundaries: number[] = [];
  collectAdjacentListBoundaries(state.doc, 0, boundaries);
  const transaction = state.tr;

  for (const position of boundaries.sort((left, right) => right - left)) {
    if (canJoin(transaction.doc, position)) transaction.join(position);
  }

  const orderedLists: number[] = [];
  transaction.doc.descendants((node, position) => {
    if (node.type === noteSchema.nodes.ordered_list && node.attrs.order !== 1) {
      orderedLists.push(position);
    }
  });
  for (const position of orderedLists) {
    const node = transaction.doc.nodeAt(position);
    if (node?.type === noteSchema.nodes.ordered_list) {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, order: 1 });
    }
  }

  return transaction.steps.length > 0 ? transaction : null;
}

export function normalizeListDocument(doc: ProseMirrorNode): ProseMirrorNode {
  const state = EditorState.create({ doc });
  const transaction = normalizeListTransaction(state);
  return transaction ? state.apply(transaction).doc : doc;
}

export function listNormalizationPlugin(): Plugin {
  return new Plugin({
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      return normalizeListTransaction(newState);
    },
  });
}
