import { describe, expect, it } from "vitest";
import { buildQuickItems } from "./quick-open-state";

const PAGES = [
  { label: "Grid", to: "/" },
  { label: "Board", to: "/board" },
  { label: "Shows", to: "/shows" },
];
const SHOWS = [
  { id: 1, name: "Minuit Décousu", slug: "minuit-decousu" },
  { id: 2, name: "Habibi Funk Hour", slug: "habibi-funk-hour" },
];
const CARDS = [
  { id: 10, subject: "Move Minuit to Fridays", status: "open" },
  { id: 11, subject: "New jingle", status: "in_progress" },
];

describe("buildQuickItems", () => {
  it("is a page launcher when the query is empty", () => {
    const items = buildQuickItems("", PAGES, SHOWS, CARDS);
    expect(items.map((i) => i.type)).toEqual(["page", "page", "page"]);
    expect(items[0]).toMatchObject({ label: "Grid", to: "/" });
  });

  it("matches pages, shows and cards by case-insensitive substring", () => {
    const items = buildQuickItems("minuit", PAGES, SHOWS, CARDS);
    // "Minuit Décousu" (show) + "Move Minuit to Fridays" (card); no page matches.
    expect(items).toEqual([
      { type: "show", label: "Minuit Décousu", sub: "/minuit-decousu", to: "/shows/1" },
      { type: "card", label: "Move Minuit to Fridays", sub: "open", to: "/board/10" },
    ]);
  });

  it("groups pages first, then shows, then cards", () => {
    const items = buildQuickItems("o", PAGES, SHOWS, CARDS); // matches Board/Shows, a show, cards
    const types = items.map((i) => i.type);
    // Pages come before shows come before cards (stable group order).
    expect(types.indexOf("page")).toBeLessThan(types.indexOf("card"));
    expect(items.some((i) => i.type === "page")).toBe(true);
  });

  it("routes each type to its addressable URL", () => {
    const items = buildQuickItems("funk", PAGES, SHOWS, CARDS);
    expect(items).toEqual([
      { type: "show", label: "Habibi Funk Hour", sub: "/habibi-funk-hour", to: "/shows/2" },
    ]);
  });
});
