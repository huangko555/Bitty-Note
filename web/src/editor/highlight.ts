export const HIGHLIGHT_COLORS = ["red", "yellow", "blue", "green"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "green";

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === "string"
    && HIGHLIGHT_COLORS.includes(value as HighlightColor);
}
