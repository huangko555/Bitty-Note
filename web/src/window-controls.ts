const WINDOW_HOVER_SUPPRESSED_CLASS = "window-hover-suppressed";

export function prepareForWindowStartup(
  root: HTMLElement = document.documentElement,
  pointerSource: EventTarget = window,
  focusRoot: Document = document,
): () => void {
  let active = false;
  let stopped = false;
  const hideRestoredEditorChrome = () => {
    focusRoot.querySelector<HTMLElement>(".format-toolbar.visible")
      ?.classList.remove("visible");
  };
  const blurRestoredFocus = (target: Element | null) => {
    if (!(target instanceof HTMLElement)) return;
    if (
      (target instanceof HTMLButtonElement && target.closest(".title-bar"))
      || target.matches(".ProseMirror, .raw-editor")
    ) {
      target.blur();
    }
  };
  const release = () => {
    if (!active) return;
    active = false;
    root.classList.remove(WINDOW_HOVER_SUPPRESSED_CLASS);
    pointerSource.removeEventListener("pointermove", release);
    pointerSource.removeEventListener("pointerdown", release);
    pointerSource.removeEventListener("keydown", release);
    focusRoot.removeEventListener("focusin", blurRestoredControl);
  };
  const blurRestoredControl = (event: Event) => {
    blurRestoredFocus(event.target instanceof Element ? event.target : null);
    hideRestoredEditorChrome();
  };
  const prepare = (suppressHover: boolean) => {
    if (stopped) return;
    if (!active) {
      active = true;
      pointerSource.addEventListener("pointermove", release);
      pointerSource.addEventListener("pointerdown", release);
      pointerSource.addEventListener("keydown", release);
      focusRoot.addEventListener("focusin", blurRestoredControl);
    }
    // Startup and minimize restoration can leave a stale CSS hover state. A
    // normal activation may be caused by clicking a title control, so hiding
    // its pointer region here would turn that first click into activation only.
    if (suppressHover) root.classList.add(WINDOW_HOVER_SUPPRESSED_CLASS);
    hideRestoredEditorChrome();
    blurRestoredFocus(focusRoot.activeElement);
  };
  const prepareAfterActivation = () => prepare(false);
  const stop = () => {
    stopped = true;
    release();
    pointerSource.removeEventListener("focus", prepareAfterActivation);
  };
  pointerSource.addEventListener("focus", prepareAfterActivation);
  prepare(true);
  return stop;
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
    button.closest(".title-bar")?.classList.toggle("is-pinned", active);
    if (document.activeElement === button) button.blur();
  });
}
