import { expect, test } from "@playwright/test";

declare const process: { env: Record<string, string | undefined> };

/**
 * The one grid happy-path e2e (docs/2 §9.5). Point PW_BASE_URL at a running
 * dev/preview server whose API database holds the demo week:
 *
 *   bun packages/api/scripts/seed-demo.ts --fresh
 *
 * The drag and the transition mutate that data — reseed between runs.
 * Since M2 every surface sits behind the session cookie; the demo account
 * below comes from the same seed, and page.request shares its cookie jar
 * with the page context.
 */
test.describe("week grid", () => {
  test.skip(
    !process.env.PW_BASE_URL,
    "PW_BASE_URL is not set — no server to point at (see playwright.config.ts)",
  );

  test.beforeEach(async ({ page }) => {
    await page.request.post("/api/v1/auth/login", {
      data: { email: "demo@ondestudio.local", password: "ondestudio-demo" },
    });
  });

  test("renders the seeded week with a state-framed card", async ({ page }) => {
    await page.goto("/");
    const card = page.locator(".grid-card", { hasText: "Minuit Décousu" }).first();
    await expect(card).toBeVisible();
  });

  test("dragging a card one hour down sends a PATCH and repositions it", async ({ page }) => {
    await page.goto("/");
    const card = page
      .locator(".grid-card[data-kind='show']", { hasText: "Minuit Décousu" })
      .first();
    await card.scrollIntoViewIfNeeded();
    const before = await card.boundingBox();
    expect(before).not.toBeNull();
    if (!before) return;

    const startX = before.x + before.width / 2;
    const startY = before.y + 10;
    const patchRequest = page.waitForRequest(
      (request) => request.method() === "PATCH" && request.url().includes("/occurrences/"),
    );

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Stepped moves: interact.js only starts a drag on real pointer motion.
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(startX, startY + (step * 48) / 8);
    }
    await page.mouse.up();

    const request = await patchRequest;
    const body = request.postDataJSON() as { startsAtWall?: string; durationMin?: number };
    expect(body.startsAtWall).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(body.durationMin).toBe(120);

    // One hour at 48px/hour: the optimistic re-render moves the card down.
    await expect(async () => {
      const after = await card.boundingBox();
      expect(after?.y ?? 0).toBeGreaterThan(before.y + 40);
    }).toPass();
  });

  test("quick-edit offers the legal transitions and recolours the frame", async ({ page }) => {
    await page.goto("/");
    // Work on NEXT week: a past occurrence transitioned to `validated` renders
    // as effective `aired` (time-driven, PD §4.4) and would recolour differently.
    await page.getByTitle("Next week").click();
    // Seeded as `dealing` — its legal transitions are validated | declined.
    const card = page.locator(".grid-card", { hasText: "Grrrnd Zero" }).first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toHaveClass(/frame-dealing/);

    await card.click();
    const popover = page.getByRole("dialog", { name: "Edit occurrence" });
    await expect(popover).toBeVisible();
    await popover.getByRole("button", { name: "validated", exact: true }).click();

    await expect(card).toHaveClass(/frame-validated/);
  });
});
