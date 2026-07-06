import { expect, test } from "@playwright/test";

declare const process: { env: Record<string, string | undefined> };

/**
 * The board happy path (M2): login, create a card, transition its lane,
 * comment, vote. Point PW_BASE_URL at a running dev/preview server seeded
 * with the demo data (bun packages/api/scripts/seed-demo.ts --fresh) — the
 * demo account below comes from that seed. Cards created here accumulate;
 * reseed between runs.
 */
test.describe("discussion board", () => {
  test.skip(
    !process.env.PW_BASE_URL,
    "PW_BASE_URL is not set — no server to point at (see playwright.config.ts)",
  );

  test.beforeEach(async ({ page }) => {
    await page.request.post("/api/v1/auth/login", {
      data: { email: "demo@ondestudio.local", password: "ondestudio-demo" },
    });
  });

  test("create → transition → comment → vote", async ({ page }) => {
    const subject = `e2e card ${Date.now()}`;
    await page.goto("/board");

    // Create: intent + subject are all a thread needs.
    await page.getByRole("button", { name: "+ card" }).click();
    await page.getByLabel("subject").fill(subject);
    await page.getByRole("button", { name: "Create card" }).click();

    // Creation routes straight into the detail drawer.
    const drawer = page.getByRole("dialog", { name: subject });
    await expect(drawer).toBeVisible();

    // Transition the status lane: open → in progress.
    await drawer
      .getByRole("group", { name: "Status" })
      .getByRole("button", { name: "in progress" })
      .click();

    // Comment in the thread.
    await drawer.getByPlaceholder("Write a reply…").fill("Bringing tapes on Friday.");
    await drawer.getByRole("button", { name: "Send" }).click();
    await expect(drawer.getByText("Bringing tapes on Friday.")).toBeVisible();

    // Back on the board, the card sits in its new lane; vote 👍 on the face.
    await drawer.getByTitle("Close").click();
    const face = page.locator('.board-lane[data-key="in_progress"] .card-face', {
      hasText: subject,
    });
    await expect(face).toBeVisible();
    await face.getByRole("button", { name: "vote want_on_air" }).click();
    await expect(face.locator(".vote-btn.mine .vote-count")).toHaveText("1");
  });
});
