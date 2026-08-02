import { expect, test } from "@playwright/test";

test("visitor chooses Jinx and a role before viewing pair statistics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search champions" }).fill("Jinx");
  await page.getByRole("link", { name: /Jinx/ }).click();
  await expect(page.getByText("Choose a role to view statistics")).toBeVisible();
  await page.getByRole("link", { name: "Bottom" }).click();
  await page.getByRole("link", { name: "2-item builds" }).click();
  await expect(page.getByText("TR1 · Ranked Solo · Emerald+")).toBeVisible();
  await expect(page.getByRole("table", { name: /Jinx BOTTOM/i })).toBeVisible();
  await expect(page.getByText(/correlation, not causation/i)).toBeVisible();
});

test("does not preselect a role and explains unavailable roles", async ({ page }) => {
  await page.goto("/champions/jinx");
  await expect(page.getByText("Choose a role to view statistics")).toBeVisible();
  await expect(page.getByRole("link", { name: "Bottom" })).toBeVisible();
  await page.goto("/champions/jinx?role=MIDDLE");
  await expect(page.getByText(/Middle is not available for this champion/i)).toBeVisible();
  await expect(page.getByText("Choose a role to view statistics")).toBeVisible();
});

test("supports every statistics view and sort", async ({ page }) => {
  await page.goto("/champions/jinx?role=BOTTOM");
  for (const [label, view] of [["Items", "items"], ["2-item builds", "pairs"], ["3-item builds", "trios"], ["Boots", "boots"]] as const) {
    await page.getByRole("link", { name: label, exact: true }).click();
    if (view !== "items") await expect(page).toHaveURL(new RegExp(`view=${view}`));
    await expect(page.getByRole("table")).toBeVisible();
  }
  for (const [label, sort] of [["Adjusted score", "adjusted"], ["Win rate", "winRate"], ["Build rate", "buildRate"], ["Sample games", "sample"]] as const) {
    await page.getByRole("link", { name: label, exact: true }).click();
    if (sort !== "adjusted") await expect(page).toHaveURL(new RegExp(`sort=${sort}`));
    await expect(page.getByRole("table")).toBeVisible();
  }
});

test("keeps low-confidence rows opt-in", async ({ page }) => {
  await page.goto("/champions/jinx?role=BOTTOM&view=trios");
  await expect(page.getByText("Show low-confidence results")).toBeVisible();
  await page.getByRole("link", { name: "Show low-confidence results" }).click();
  await expect(page).toHaveURL(/lowConfidence=1/);
  await expect(page.getByText("Low confidence")).toBeVisible();
});

test("keeps the primary controls keyboard reachable", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "Search champions" });
  await search.focus();
  await expect(search).toBeFocused();
  await page.getByRole("link", { name: /Jinx/ }).focus();
  await expect(page.getByRole("link", { name: /Jinx/ })).toBeFocused();
});

test("does not overflow a 390px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/champions/jinx?role=BOTTOM&view=pairs");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("renders a real 404 for an unknown champion", async ({ page }) => {
  const response = await page.goto("/champions/not-a-champion");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("That champion is not in this publication.")).toBeVisible();
});
