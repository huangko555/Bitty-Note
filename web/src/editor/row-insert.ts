import createLucideElement from "lucide/dist/esm/createElement.mjs";
import Plus from "lucide/dist/esm/icons/plus.mjs";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { t } from "../i18n";
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

function insertButton(view: EditorView, getPosition: () => number | undefined): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "row-insert-button";
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
    if (insertBlankParagraph(view.state, view.dispatch, position)) view.focus();
  });
  return button;
}

function lastLineIsBlank(doc: EditorState["doc"]): boolean {
  let node = doc.lastChild;
  while (node && !node.isTextblock) node = node.lastChild;
  return Boolean(node?.isTextblock && node.content.size === 0);
}

function decorations(doc: EditorState["doc"]): DecorationSet {
  const positions = new Set<number>();
  if (!lastLineIsBlank(doc)) positions.add(doc.content.size);
  doc.forEach((node, position) => {
    if (node.type === noteSchema.nodes.heading && position > 0) positions.add(position);
  });
  return DecorationSet.create(
    doc,
    [...positions]
      .sort((left, right) => left - right)
      .map((position) => Decoration.widget(
        position,
        (view, getPosition) => insertButton(view, getPosition),
        { key: `row-insert-${position}`, side: -1 },
      )),
  );
}

export function rowInsertPlugin(): Plugin<DecorationSet> {
  return new Plugin({
    key: rowInsertKey,
    state: {
      init: (_config, state) => decorations(state.doc),
      apply: (transaction, current) => transaction.docChanged
        ? decorations(transaction.doc)
        : current.map(transaction.mapping, transaction.doc),
    },
    props: {
      decorations: (state) => rowInsertKey.getState(state) ?? null,
    },
  });
}
