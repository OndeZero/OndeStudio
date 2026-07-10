import { ref } from "vue";

/**
 * Global quick-open palette (docs/2 §11 fast-follow): a Cmd/Ctrl-K jump to any
 * page, show or board card. Open state is module-level like rail-state.ts so
 * the shell's keydown and the palette component share it without store
 * ceremony. The item builder is pure so the matching/capping is unit-testable.
 */
export const quickOpenOpen = ref(false);

export type QuickItemType = "page" | "show" | "card";

export interface QuickItem {
  type: QuickItemType;
  label: string;
  sub: string | null;
  to: string;
}

/** Per-group result caps — the palette is a jump, not a browser. */
const SHOW_CAP = 6;
const CARD_CAP = 6;

/**
 * Build the ranked, grouped result list. With no query the palette is a page
 * launcher (every nav destination); once typing, it also matches shows by name
 * and board cards by subject. Matching is a case-insensitive substring — enough
 * for a handful of shows and an active board.
 */
export function buildQuickItems(
  query: string,
  pages: { label: string; to: string }[],
  shows: { id: number; name: string; slug: string }[],
  cards: { id: number; subject: string; status: string }[],
): QuickItem[] {
  const q = query.trim().toLowerCase();
  const matches = (text: string): boolean => text.toLowerCase().includes(q);

  const pageItems: QuickItem[] = pages
    .filter((page) => q === "" || matches(page.label))
    .map((page) => ({ type: "page", label: page.label, sub: null, to: page.to }));

  if (q === "") return pageItems;

  const showItems: QuickItem[] = shows
    .filter((show) => matches(show.name))
    .slice(0, SHOW_CAP)
    .map((show) => ({
      type: "show",
      label: show.name,
      sub: `/${show.slug}`,
      to: `/shows/${show.id}`,
    }));

  const cardItems: QuickItem[] = cards
    .filter((card) => matches(card.subject))
    .slice(0, CARD_CAP)
    .map((card) => ({
      type: "card",
      label: card.subject,
      sub: card.status,
      to: `/board/${card.id}`,
    }));

  return [...pageItems, ...showItems, ...cardItems];
}
