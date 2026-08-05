const CARET_MARGIN = 8;

interface SelectionVisibilityTarget {
  ensureSelectionVisible(bottomInset: number): void;
}

export function createSelectionVisibilityCoordinator(
  toolbar: HTMLElement,
  getTarget: () => SelectionVisibilityTarget | null,
  requestFrame: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window),
  defer: (callback: () => void) => void = window.queueMicrotask.bind(window),
): {
  editorPressStarted: (event?: Event) => void;
  focusChanged: (visible: boolean) => void;
  selectionChanged: () => void;
  show: () => void;
} {
  let scheduled = false;
  let editorPressActive = false;
  let pendingVisible = false;
  let restoredFocus = false;
  const schedule = () => {
    if (scheduled || !getTarget()) return;
    scheduled = true;
    requestFrame(() => {
      scheduled = false;
      const target = getTarget();
      if (
        target
        && toolbar.isConnected
        && toolbar.classList.contains("visible")
      ) {
        target.ensureSelectionVisible(toolbar.getBoundingClientRect().height);
      }
    });
  };
  const show = () => {
    restoredFocus = false;
    pendingVisible = false;
    toolbar.classList.add("visible");
    schedule();
  };

  return {
    editorPressStarted: (event) => {
      const eventTarget = event?.target;
      const editorControl = eventTarget instanceof Element
        && eventTarget.closest("[data-editor-control]");
      if (editorControl) {
        if (restoredFocus && !toolbar.classList.contains("visible")) {
          const activeElement = toolbar.ownerDocument.activeElement;
          if (
            activeElement instanceof HTMLElement
            && activeElement.classList.contains("ProseMirror")
          ) {
            activeElement.blur();
          }
        }
        restoredFocus = false;
        return;
      }
      if (
        editorPressActive
        || toolbar.classList.contains("visible")
      ) {
        return;
      }
      const target = toolbar.ownerDocument.defaultView;
      if (!target) return;
      restoredFocus = false;
      pendingVisible = true;
      editorPressActive = true;
      let finishQueued = false;
      const cleanup = () => {
        target.removeEventListener("click", complete, true);
        target.removeEventListener("pointercancel", cancel, true);
        target.removeEventListener("blur", cancel, true);
      };
      const finish = () => {
        cleanup();
        editorPressActive = false;
        if (pendingVisible) {
          pendingVisible = false;
          toolbar.classList.add("visible");
          schedule();
        }
      };
      const complete = () => {
        if (finishQueued) return;
        finishQueued = true;
        defer(finish);
      };
      const cancel = () => {
        cleanup();
        editorPressActive = false;
        pendingVisible = false;
      };
      // Wait for the actual click, not pointerup. Some WebViews may run queued
      // work between pointerup and click, which would expose the toolbar under
      // the still-active pointer and redirect the click to a toolbar button.
      target.addEventListener("click", complete, true);
      target.addEventListener("pointercancel", cancel, true);
      target.addEventListener("blur", cancel, true);
    },
    focusChanged: (visible) => {
      if (!visible) {
        restoredFocus = false;
        pendingVisible = false;
        toolbar.classList.remove("visible");
        return;
      }
      if (editorPressActive) {
        return;
      }
      if (toolbar.classList.contains("visible")) {
        schedule();
        return;
      }
      // Native WebViews can restore contenteditable focus while activating the
      // window, before the pointer event that identifies the user's target.
      // Keep the toolbar hidden until that actual press completes.
      restoredFocus = true;
    },
    selectionChanged: () => {
      if (toolbar.classList.contains("visible")) schedule();
    },
    show,
  };
}

export function keepRectVisible(
  host: HTMLElement,
  target: Pick<DOMRect, "top" | "bottom">,
  bottomInset = 0,
): void {
  const viewport = host.getBoundingClientRect();
  const lowerOverflow = target.bottom
    - (viewport.bottom - bottomInset - CARET_MARGIN);
  if (lowerOverflow > 0) {
    host.scrollTop += lowerOverflow;
    return;
  }

  const upperOverflow = viewport.top + CARET_MARGIN - target.top;
  if (upperOverflow > 0) host.scrollTop -= upperOverflow;
}
