export type RenameFeedbackPlacement = "default" | "below-title";

type RenameFailureNotifier = (message: string, placement: RenameFeedbackPlacement) => void;

export function showRenameFailure(
  input: HTMLInputElement,
  message: string,
  placement: RenameFeedbackPlacement,
  notify: RenameFailureNotifier,
): void {
  input.disabled = false;
  input.classList.add("is-invalid");
  input.setAttribute("aria-invalid", "true");
  notify(message, placement);
  input.focus();
  input.select();
}

export function clearRenameFailure(input: HTMLInputElement): void {
  input.classList.remove("is-invalid");
  input.removeAttribute("aria-invalid");
}
