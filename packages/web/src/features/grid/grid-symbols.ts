import type { IssueFlag, SlotKind } from "@ondestudio/shared";

/**
 * The grid's shared glyph vocabulary — plain text, no icon library
 * (sustainable web design, PD §8.1). Used by cards, quick-edit, the create
 * dialog and the legend so the coding never drifts between surfaces.
 */

export const SLOT_KIND_GLYPHS: Record<SlotKind, string> = {
  show: "▸",
  series: "≣",
  echo: "⟳",
  live: "●",
  rotation: "∿",
};

export const ISSUE_FLAG_LETTERS: Record<IssueFlag, string> = {
  technical: "T",
  metadata: "M",
  editorial: "E",
};

export const ISSUE_FLAG_TITLES: Record<IssueFlag, string> = {
  technical: "Technical issue — format, loudness or duration problem",
  metadata: "Metadata issue — missing or placeholder title/description",
  editorial: "Editorial issue — needs team review",
};
