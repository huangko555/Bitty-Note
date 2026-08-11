import { TextSelection } from "prosemirror-state";
import { type EditorView } from "prosemirror-view";

const TEXTBLOCK_SELECTOR = "p, h1, .raw-markdown-block";
const pendingRecovery = new WeakMap<EditorView, number>();

export function recoverClickedTextblockSelection(
  view: EditorView,
  eventTarget: EventTarget | null,
  requestFrame: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window),
): void {
  const recoveryId = (pendingRecovery.get(view) ?? 0) + 1;
  pendingRecovery.set(view, recoveryId);
  if (!(eventTarget instanceof Element) || eventTarget.closest("[data-editor-control]")) return;
  const textblock = eventTarget.closest<HTMLElement>(TEXTBLOCK_SELECTOR);
  if (!textblock || !view.dom.contains(textblock)) return;

  requestFrame(() => {
    requestFrame(() => {
      if (pendingRecovery.get(view) !== recoveryId || !textblock.isConnected) return;
      let start: number;
      try {
        start = view.posAtDOM(textblock, 0);
      } catch {
        return;
      }
      const $start = view.state.doc.resolve(start);
      const targetNode = $start.parent;
      if (!targetNode.isTextblock) return;
      const selection = view.state.selection;
      if (selection.$from.parent === targetNode && selection.$to.parent === targetNode) return;

      view.dispatch(view.state.tr.setSelection(TextSelection.create(
        view.state.doc,
        start + targetNode.content.size,
      )));
    });
  });
}
