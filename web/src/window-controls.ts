const WINDOW_HOVER_SUPPRESSED_CLASS = "window-hover-suppressed";

export function prepareForWindowMinimize(
  button: HTMLButtonElement,
  root: HTMLElement = document.documentElement,
  pointerSource: EventTarget = window,
): void {
  button.blur();
  root.classList.add(WINDOW_HOVER_SUPPRESSED_CLASS);
  pointerSource.addEventListener("pointermove", () => {
    root.classList.remove(WINDOW_HOVER_SUPPRESSED_CLASS);
  }, { once: true });
}

export function syncPinButtons(root: ParentNode, active: boolean): void {
  root.querySelectorAll<HTMLButtonElement>('[data-action="pin"]').forEach((button) => {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  root.querySelectorAll<HTMLElement>(".title-pin-indicator").forEach((indicator) => {
    indicator.hidden = !active;
  });
}
