import { describe, expect, it, vi } from "vitest";

import { clearRenameFailure, showRenameFailure } from "./rename-feedback";

describe("rename failure feedback", () => {
  it("keeps the input editable, marks it invalid, and forwards the requested placement", () => {
    const input = document.createElement("input");
    input.value = "Duplicate";
    document.body.append(input);
    const notify = vi.fn();

    showRenameFailure(input, "Name already exists", "below-title", notify);

    expect(input.disabled).toBe(false);
    expect(input.classList.contains("is-invalid")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(notify).toHaveBeenCalledWith("Name already exists", "below-title");

    clearRenameFailure(input);
    expect(input.classList.contains("is-invalid")).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });
});
