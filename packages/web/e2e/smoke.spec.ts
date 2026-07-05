import { expect, test } from "@playwright/test";

declare const process: { env: Record<string, string | undefined> };

// M0 smoke only: prove the shell serves and renders. The real e2e coverage
// (the grid happy-path, docs/2 §9.5) lands at M1 with the grid itself.
test("the shell renders the OndeStudio wordmark", async ({ page }) => {
  test.skip(
    !process.env.PW_BASE_URL,
    "PW_BASE_URL is not set — no server to point at (see playwright.config.ts)",
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "OndeStudio" })).toBeVisible();
});
