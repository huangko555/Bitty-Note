import createLucideElement from "lucide/dist/esm/createElement.mjs";
import Plus from "lucide/dist/esm/icons/plus.mjs";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { t } from "../i18n";
import {
  DOCUMENT_END_ZONE_CLASS,
  describeDocumentTail,
} from "./editor-tail";
import { noteSchema } from "./schema";

const rowInsertKey = new PluginKey<DecorationSet>("rowInsert");

export function insertBlankParagraph(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  position: number,
  expandHeadingAt: number | null = null,
): boolean {
  if (position < 0 || position > state.doc.content.size) return false;
  const $position = state.doc.resolve(position);
  if ($position.depth !== 0) return false;
  const heading = expandHeadingAt === null ? null : state.doc.nodeAt(expandHeadingAt);
  if (
    expandHeadingAt !== null
    && (heading?.type !== noteSchema.nodes.heading || !heading.attrs.collapsed)
  ) return false;
  if (!dispatch) return true;

  const previous = $position.nodeBefore;
  const continuesList = previous?.type === noteSchema.nodes.bullet_list
    || previous?.type === noteSchema.nodes.ordered_list;
  const insertPosition = continuesList ? position - 1 : position;
  const node = continuesList
    ? noteSchema.nodes.list_item.create(
      {
        checked: typeof previous.lastChild?.attrs.checked === "boolean" ? false : null,
      },
      noteSchema.nodes.paragraph.create(),
    )
    : noteSchema.nodes.paragraph.create();
  const transaction = state.tr;
  if (heading && expandHeadingAt !== null) {
    transaction.setNodeMarkup(expandHeadingAt, undefined, {
      ...heading.attrs,
      collapsed: false,
    });
  }
  transaction.insert(insertPosition, node);
  transaction.setSelection(TextSelection.create(
    transaction.doc,
    insertPosition + (continuesList ? 2 : 1),
  ));
  dispatch(transaction.scrollIntoView());
  return true;
}

function insertButton(
  view: EditorView,
  getPosition: () => number | undefined,
  onInsert?: () => void,
  terminal = false,
  expandHeadingAt: number | null = null,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "row-insert-button";
  if (terminal) button.classList.add("is-terminal", DOCUMENT_END_ZONE_CLASS);
  button.dataset.editorControl = "true";
  button.setAttribute("aria-label", t("insertBlankLine"));
  button.setAttribute("contenteditable", "false");
  button.append(createLucideElement(Plus, {
    class: "lucide-icon",
    "aria-hidden": "true",
  }));
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const position = getPosition();
    if (typeof position !== "number") return;
    const changed = expandHeadingAt === null
      ? insertBlankParagraph(view.state, view.dispatch, position)
      : terminal
        ? expandHeadingForInsertion(view.state, view.dispatch, expandHeadingAt)
        : insertBlankParagraph(view.state, view.dispatch, position, expandHeadingAt);
    if (changed) {
      view.focus();
      onInsert?.();
    }
  });
  return button;
}

function expandHeadingForInsertion(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  headingPosition: number,
): boolean {
  const heading = state.doc.nodeAt(headingPosition);
  if (heading?.type !== noteSchema.nodes.heading || !heading.attrs.collapsed) return false;
  if (!dispatch) return true;

  const transaction = state.tr.setNodeMarkup(headingPosition, undefined, {
    ...heading.attrs,
    collapsed: false,
  });
  const tail = describeDocumentTail(transaction.doc);
  const blankPosition = tail.kind === "blank" ? tail.terminalBlankNodePosition : null;
  if (blankPosition === null) {
    const insertPosition = transaction.doc.content.size;
    transaction.insert(insertPosition, noteSchema.nodes.paragraph.create());
    transaction.setSelection(TextSelection.create(transaction.doc, insertPosition + 1));
  } else {
    transaction.setSelection(TextSelection.create(transaction.doc, blankPosition + 1));
  }
  dispatch(transaction.scrollIntoView());
  return true;
}

function emptyDocumentEndZone(): HTMLElement {
  const zone = document.createElement("div");
  zone.className = `${DOCUMENT_END_ZONE_CLASS} is-placeholder`;
  zone.dataset.editorControl = "true";
  zone.setAttribute("aria-hidden", "true");
  zone.setAttribute("contenteditable", "false");
  return zone;
}

function decorations(doc: EditorState["doc"], onInsert?: () => void): DecorationSet {
  const headingPositions: Array<{
    position: number;
    expandHeadingAt: number | null;
  }> = [];
  let precedingCollapsedHeading: number | null = null;
  doc.forEach((node, position) => {
    if (node.type !== noteSchema.nodes.heading) return;
    if (position > 0) {
      headingPositions.push({ position, expandHeadingAt: precedingCollapsedHeading });
    }
    precedingCollapsedHeading = node.attrs.collapsed ? position : null;
  });
  const tail = describeDocumentTail(doc);
  const tailKey = tail.kind === "collapsed-heading"
    ? `${tail.kind}-${tail.collapsedHeadingPosition}`
    : tail.kind;
  const items: Decoration[] = headingPositions.map(({ position, expandHeadingAt }) => Decoration.widget(
    position,
    (view, getPosition) => insertButton(
      view,
      getPosition,
      onInsert,
      false,
      expandHeadingAt,
    ),
    { key: `row-insert-${position}`, side: -1 },
  ));
  items.push(Decoration.widget(
    doc.content.size,
    tail.kind === "collapsed-heading"
      ? (view, getPosition) => insertButton(
        view,
        getPosition,
        onInsert,
        true,
        tail.collapsedHeadingPosition,
      )
      : tail.kind === "blank"
        ? emptyDocumentEndZone
        : (view, getPosition) => insertButton(view, getPosition, onInsert, true),
    {
      key: `document-end-zone-${tailKey}`,
      side: -1,
    },
  ));
  return DecorationSet.create(doc, items);
}

export function rowInsertPlugin(onInsert?: () => void): Plugin<DecorationSet> {
  return new Plugin({
    key: rowInsertKey,
    state: {
      init: (_config, state) => decorations(state.doc, onInsert),
      apply: (transaction, current) => transaction.docChanged
        ? decorations(transaction.doc, onInsert)
        : current.map(transaction.mapping, transaction.doc),
    },
    props: {
      decorations: (state) => rowInsertKey.getState(state) ?? null,
    },
  });
}
