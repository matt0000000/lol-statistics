import { expect, test } from "@playwright/test";
import { seedFixture } from "./fixture";

test.describe.configure({ mode: "serial" });

test("published fixture exposes an exact stale state after the six-hour threshold", async ({ page }) => {
  await seedFixture("stale");
  await page.goto("/status");
  await expect(page.getByText("Dataset state:").locator("..")).toContainText("stale");
  await expect(page.getByText("TR1 · Ranked Solo · Emerald+", { exact: true })).toBeVisible();
  await expect(page.getByText(/Statistics were last updated/i)).toBeVisible();
});

test("warming publication pointer renders warming UI from the database", async ({ page }) => {
  await seedFixture("warming");
  await page.goto("/champions/jinx");
  await expect(page.getByText("Dataset warming", { exact: true })).toBeVisible();
  await expect(page.getByText("Champion data is being prepared.")).toBeVisible();
  await expect(page.getByText(/Published|Data through/)).toHaveCount(0);
});

test("fresh publication is inside the boundary and has no stale banner", async ({ page }) => {
  await seedFixture("fresh");
  await page.goto("/champions/jinx?role=BOTTOM");
  await expect(page.getByText(/Published/)).toBeVisible();
  await expect(page.getByText(/Statistics were last updated/i)).toHaveCount(0);
});
