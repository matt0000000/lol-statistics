import { expect, test } from "@playwright/test";

test("published fixture exposes a stale state after the six-hour threshold", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByText(/Dataset state:/i)).toContainText(/stale|fresh/i);
  await expect(page.getByText("TR1 · Ranked Solo · Emerald+", { exact: true })).toBeVisible();
});

test("warming API state remains machine-readable and distinct", async ({ page }) => {
  await page.route("**/api/meta", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "dataset_warming" }) });
  });
  const response = await page.goto("/api/meta");
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({ code: "dataset_warming" });
});

test("stale and warming banners use distinct copy", async ({ page }) => {
  await page.goto("/status");
  const state = await page.getByText(/Dataset state:/i).textContent();
  expect(state).toMatch(/stale|fresh/i);
  await page.goto("/methodology");
  await expect(page.getByText(/correlation, not causation/i)).toBeVisible();
});
