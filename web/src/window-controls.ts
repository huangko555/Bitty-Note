export function syncPinButtons(root: ParentNode, active: boolean): void {
  root.querySelectorAll<HTMLButtonElement>('[data-action="pin"]').forEach((button) => {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
