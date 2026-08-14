export interface PointerPosition {
  clientX: number;
  clientY: number;
  target: EventTarget | null;
}

export interface PointerButtonPosition extends PointerPosition {
  button: number;
}

export function isPointerInsideElement(
  element: HTMLElement,
  event: PointerPosition,
): boolean {
  if (event.target instanceof Node && element.contains(event.target)) return true;
  const bounds = element.getBoundingClientRect();
  return event.clientX >= bounds.left
    && event.clientX <= bounds.right
    && event.clientY >= bounds.top
    && event.clientY <= bounds.bottom;
}

export function shouldBeginTitleBarDrag(
  event: PointerButtonPosition,
  renameInput: HTMLInputElement | null,
): boolean {
  if (event.button !== 0) return false;
  if (renameInput && isPointerInsideElement(renameInput, event)) return false;
  return !(event.target instanceof Element && event.target.closest(".no-drag"));
}
