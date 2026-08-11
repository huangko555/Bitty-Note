import createLucideElement from "lucide/dist/esm/createElement.mjs";
import Plus from "lucide/dist/esm/icons/plus.mjs";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { t } from "../i18n";
import { DOCUMENT_END_ZONE_CLASS, terminalBlankPosition } from "./editor-tail";
import { noteSchema } from "./schema";

const rowInsertKey = new PluginKey<DecorationSet>("rowInsert");

export function insertBlankParagraph(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  position: number,
): boolean {
  if (position < 0 || position > state.doc.content.size) return false;
  const $position = state.doc.resolve(position);
  if ($position.depth !== 0) return false;
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
  const transaction = state.tr.insert(insertPosition, node);
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
    if (insertBlankParagraph(view.state, view.dispatch, position)) {
      view.focus();
      onInsert?.();
    }
  });
  return button;
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
  const headingPositions: number[] = [];
  let finalHeadingCollapsed = false;
  for (let index = doc.childCount - 1; index >= 0; index -= 1) {
    const node = doc.child(index);
    if (node.type === noteSchema.nodes.heading) {
      finalHeadingCollapsed = Boolean(node.attrs.collapsed && index < doc.childCount - 1);
      break;
    }
  }
  doc.forEach((node, position) => {
    if (node.type === noteSchema.nodes.heading && position > 0) headingPositions.push(position);
  });
  const terminalBlank = terminalBlankPosition(doc);
  const items: Decoration[] = headingPositions.map((position) => Decoration.widget(
    position,
    (view, getPosition) => insertButton(view, getPosition, onInsert),
    { key: `row-insert-${position}`, side: -1 },
  ));
  if (!finalHeadingCollapsed) {
    items.push(Decoration.widget(
      doc.content.size,
      terminalBlank !== null
        ? emptyDocumentEndZone
        : (view, getPosition) => insertButton(view, getPosition, onInsert, true),
      { key: "document-end-zone", side: -1 },
    ));
  }
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
