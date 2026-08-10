import createLucideElement from "lucide/dist/esm/createElement.mjs";
import ChevronDown from "lucide/dist/esm/icons/chevron-down.mjs";
import ChevronUp from "lucide/dist/esm/icons/chevron-up.mjs";
import { type Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { t } from "../i18n";
import { preserveVisualAnchorDuring } from "./editor-viewport";
import { noteSchema } from "./schema";

function headingSectionEnd(doc: ProseMirrorNode, headingIndex: number): number {
  let index = headingIndex + 1;
  while (index < doc.childCount && doc.child(index).type !== noteSchema.nodes.heading) {
    index += 1;
  }
  return index;
}

function foldable(node: ProseMirrorNode, doc: ProseMirrorNode, index = -1): boolean {
  if (node.type === noteSchema.nodes.list_item) return node.childCount > 1;
  return node.type === noteSchema.nodes.heading
    && index >= 0
    && headingSectionEnd(doc, index) > index + 1;
}

function foldButton(
  ownerPosition: number,
  owner: ProseMirrorNode,
): (view: EditorView) => HTMLElement {
  return (view) => {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.className = `fold-toggle${owner.attrs.collapsed ? " is-collapsed" : ""}`;
    button.dataset.editorControl = "true";
    button.setAttribute("contenteditable", "false");
    button.setAttribute("aria-label", owner.attrs.collapsed ? t("expandContent") : t("collapseContent"));
    button.title = owner.attrs.collapsed ? t("expandContent") : t("collapseContent");
    button.append(createLucideElement(owner.attrs.collapsed ? ChevronDown : ChevronUp, {
      class: "lucide-icon",
      "aria-hidden": "true",
    }));
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const node = view.state.doc.nodeAt(ownerPosition);
      if (!node || node.type !== owner.type) return;
      const collapsing = !node.attrs.collapsed;
      const transaction = view.state.tr.setNodeMarkup(ownerPosition, undefined, {
        ...node.attrs,
        collapsed: collapsing,
      });
      if (collapsing) {
        const caret = node.type === noteSchema.nodes.heading
          ? ownerPosition + node.nodeSize - 1
          : ownerPosition + node.firstChild!.nodeSize;
        let hiddenFrom = caret;
        let hiddenTo = ownerPosition + node.nodeSize;
        if (node.type === noteSchema.nodes.heading) {
          let position = 0;
          for (let index = 0; index < view.state.doc.childCount; index += 1) {
            const child = view.state.doc.child(index);
            if (position === ownerPosition) {
              hiddenFrom = ownerPosition + node.nodeSize;
              hiddenTo = hiddenFrom;
              const end = headingSectionEnd(view.state.doc, index);
              for (let childIndex = index + 1; childIndex < end; childIndex += 1) {
                hiddenTo += view.state.doc.child(childIndex).nodeSize;
              }
              break;
            }
            position += child.nodeSize;
          }
        }
        if (
          view.state.selection.from < hiddenTo
          && view.state.selection.to > hiddenFrom
        ) {
          transaction.setSelection(TextSelection.create(transaction.doc, caret));
        }
      }
      const host = view.dom.parentElement;
      const locateOwnerTop = (): number | null => {
        const ownerDom = view.nodeDOM(ownerPosition);
        return ownerDom instanceof HTMLElement ? ownerDom.getBoundingClientRect().top : null;
      };
      if (host) {
        preserveVisualAnchorDuring(host, locateOwnerTop, () => view.dispatch(transaction));
      } else {
        view.dispatch(transaction);
      }
    });
    return button;
  };
}

function foldingDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  let topLevelPosition = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    if (node.type === noteSchema.nodes.heading && foldable(node, doc, index)) {
      decorations.push(Decoration.node(
        topLevelPosition,
        topLevelPosition + node.nodeSize,
        { class: "has-fold-toggle" },
      ));
      decorations.push(Decoration.widget(
        topLevelPosition + node.nodeSize - 1,
        foldButton(topLevelPosition, node),
        { side: 1 },
      ));
      if (node.attrs.collapsed) {
        let hiddenPosition = topLevelPosition + node.nodeSize;
        const end = headingSectionEnd(doc, index);
        for (let hiddenIndex = index + 1; hiddenIndex < end; hiddenIndex += 1) {
          const hidden = doc.child(hiddenIndex);
          decorations.push(Decoration.node(
            hiddenPosition,
            hiddenPosition + hidden.nodeSize,
            { class: "is-folded-content" },
          ));
          hiddenPosition += hidden.nodeSize;
        }
      }
    }
    topLevelPosition += node.nodeSize;
  }

  doc.descendants((node, position) => {
    if (node.type !== noteSchema.nodes.list_item || !foldable(node, doc)) return true;
    decorations.push(Decoration.node(
      position,
      position + node.nodeSize,
      {
        class: `has-fold-toggle${node.attrs.collapsed ? " is-collapsed-list-item" : ""}`,
      },
    ));
    decorations.push(Decoration.widget(
      position + node.firstChild!.nodeSize,
      foldButton(position, node),
      { side: 1 },
    ));
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

export function foldingPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => foldingDecorations(state.doc),
    },
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const transaction = newState.tr;
      newState.doc.descendants((node, position) => {
        if (
          node.type === noteSchema.nodes.list_item
          && node.attrs.collapsed
          && node.childCount <= 1
        ) {
          transaction.setNodeMarkup(position, undefined, { ...node.attrs, collapsed: false });
        }
        return true;
      });
      let position = 0;
      for (let index = 0; index < newState.doc.childCount; index += 1) {
        const node = newState.doc.child(index);
        if (
          node.type === noteSchema.nodes.heading
          && node.attrs.collapsed
          && headingSectionEnd(newState.doc, index) === index + 1
        ) {
          transaction.setNodeMarkup(position, undefined, { ...node.attrs, collapsed: false });
        }
        position += node.nodeSize;
      }
      return transaction.steps.length ? transaction : null;
    },
  });
}
