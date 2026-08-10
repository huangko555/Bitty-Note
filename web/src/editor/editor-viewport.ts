const CARET_MARGIN = 8;

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

export function autoScrollForPointer(
  host: HTMLElement,
  clientY: number,
  edgeSize = 34,
  step = 18,
): void {
  const viewport = host.getBoundingClientRect();
  if (clientY < viewport.top + edgeSize) host.scrollTop -= step;
  else if (clientY > viewport.bottom - edgeSize) host.scrollTop += step;
}

export function scrollForWheel(
  host: HTMLElement,
  deltaY: number,
  deltaMode: number,
  lineSize = 16,
): void {
  const multiplier = deltaMode === WheelEvent.DOM_DELTA_LINE
    ? lineSize
    : deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? host.getBoundingClientRect().height
      : 1;
  host.scrollBy({ top: deltaY * multiplier, behavior: "smooth" });
}

export function preserveViewportDuring<T>(
  host: HTMLElement,
  change: () => T,
): T {
  const scrollTop = host.scrollTop;
  const result = change();
  host.scrollTop = scrollTop;
  return result;
}

export function preserveVisualAnchorDuring<T>(
  host: HTMLElement,
  locateAnchorTop: () => number | null,
  change: () => T,
  requestFrame: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window),
): T {
  const before = locateAnchorTop();
  const result = change();
  if (before === null) return result;
  requestFrame(() => {
    if (!host.isConnected) return;
    const after = locateAnchorTop();
    if (after !== null) host.scrollTop += after - before;
  });
  return result;
}

export function alignDocumentBoundary(
  host: HTMLElement,
  locateBoundary: () => number | null,
  preferredClientY: number,
  requestFrame: (callback: FrameRequestCallback) => number = window.requestAnimationFrame.bind(window),
): void {
  requestFrame(() => {
    if (!host.isConnected) return;
    const boundary = locateBoundary();
    if (boundary === null) return;
    const viewport = host.getBoundingClientRect();
    const preferred = Math.max(
      viewport.top + CARET_MARGIN,
      Math.min(preferredClientY, viewport.bottom - CARET_MARGIN),
    );
    host.scrollTop = Math.max(0, host.scrollTop + boundary - preferred);
  });
}
