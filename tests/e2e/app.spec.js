import { test, expect } from "@playwright/test";

test("interactive controls are available", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /GraphBin-Viz/i })
  ).toBeVisible();

  await page.getByRole("tab", { name: /Interactive View/i }).click();

  await expect(page.getByLabel("Hide isolated contigs")).toBeVisible();
  await expect(page.locator("#graph-canvas")).toBeVisible();
});
