const WINDOW_HOVER_SUPPRESSED_CLASS = "window-hover-suppressed";

export function prepareForWindowStartup(
  root: HTMLElement = document.documentElement,
  pointerSource: EventTarget = window,
  focusRoot: Document = document,
): () => void {
  root.classList.add(WINDOW_HOVER_SUPPRESSED_CLASS);
  let active = true;
  const release = () => {
    if (!active) return;
    active = false;
    root.classList.remove(WINDOW_HOVER_SUPPRESSED_CLASS);
    pointerSource.removeEventListener("pointermove", release);
    pointerSource.removeEventListener("pointerdown", release);
    pointerSource.removeEventListener("keydown", release);
    focusRoot.removeEventListener("focusin", blurRestoredTitleControl);
  };
  const blurRestoredTitleControl = (event: Event) => {
    const target = event.target;
    if (
      target instanceof HTMLButtonElement
      && target.closest(".title-bar")
    ) {
      target.blur();
    }
  };
  pointerSource.addEventListener("pointermove", release);
  pointerSource.addEventListener("pointerdown", release);
  pointerSource.addEventListener("keydown", release);
  focusRoot.addEventListener("focusin", blurRestoredTitleControl);
  return release;
}

export function prepareForWindowMinimize(
  button: HTMLButtonElement,
  root: HTMLElement = document.documentElement,
  pointerSource: EventTarget = window,
): void {
  button.blur();
  root.classList.add(WINDOW_HOVER_SUPPRESSED_CLASS);
  pointerSource.addEventListener("focus", () => {
    pointerSource.addEventListener("pointermove", () => {
      root.classList.remove(WINDOW_HOVER_SUPPRESSED_CLASS);
    }, { once: true });
  }, { once: true });
}

export function syncPinButtons(root: ParentNode, active: boolean): void {
  root.querySelectorAll<HTMLButtonElement>('[data-action="pin"]').forEach((button) => {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    if (document.activeElement === button) button.blur();
  });
  root.querySelectorAll<HTMLElement>(".title-pin-indicator").forEach((indicator) => {
    indicator.hidden = !active;
  });
}
