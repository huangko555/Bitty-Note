const CARET_MARGIN = 8;

interface SelectionVisibilityTarget {
  ensureSelectionVisible(): void;
}

export function createSelectionVisibilityCoordinator(
  toolbar: HTMLElement,
  getTarget: () => SelectionVisibilityTarget | null,
  requestFrame: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window),
): {
  editorPressStarted: () => void;
  focusChanged: (visible: boolean) => void;
  selectionChanged: () => void;
} {
  let scheduled = false;
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
        target.ensureSelectionVisible();
      }
    });
  };

  return {
    editorPressStarted: () => {
      if (toolbar.classList.contains("ignore-current-press")) return;
      toolbar.classList.add("ignore-current-press");
      const target = toolbar.ownerDocument.defaultView;
      if (!target) return;
      const release = () => {
        toolbar.classList.remove("ignore-current-press");
        target.removeEventListener("pointerup", release, true);
        target.removeEventListener("pointercancel", release, true);
      };
      target.addEventListener("pointerup", release, true);
      target.addEventListener("pointercancel", release, true);
    },
    focusChanged: (visible) => {
      toolbar.classList.toggle("visible", visible);
      if (visible) schedule();
    },
    selectionChanged: () => {
      if (toolbar.classList.contains("visible")) schedule();
    },
  };
}

export function keepRectVisible(
  host: HTMLElement,
  target: Pick<DOMRect, "top" | "bottom">,
): void {
  const viewport = host.getBoundingClientRect();
  const lowerOverflow = target.bottom - (viewport.bottom - CARET_MARGIN);
  if (lowerOverflow > 0) {
    host.scrollTop += lowerOverflow;
    return;
  }

  const upperOverflow = viewport.top + CARET_MARGIN - target.top;
  if (upperOverflow > 0) host.scrollTop -= upperOverflow;
}
