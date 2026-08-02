import { expect, test } from "@playwright/test";
import { seedFixture } from "./fixture";

test.beforeEach(async () => { await seedFixture("fresh"); });

test("visitor chooses Jinx and a role before viewing pair statistics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search champions" }).fill("Jinx");
  await page.getByRole("link", { name: /Jinx/ }).click();
  await expect(page.getByText("Choose a role to view statistics")).toBeVisible();
  await page.getByRole("link", { name: "Bottom" }).click();
  await page.getByRole("link", { name: "2-item builds" }).click();
  await expect(page.getByText("TR1 · Ranked Solo · Emerald+", { exact: true })).toBeVisible();
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

test("supports every statistics view and each sort's active semantics and row ordering", async ({ page }) => {
  await page.goto("/champions/jinx?role=BOTTOM");
  for (const [label, view] of [["Items", "items"], ["2-item builds", "pairs"], ["3-item builds", "trios"], ["Boots", "boots"]] as const) {
    await page.getByRole("link", { name: label, exact: true }).click();
    if (view !== "items") await expect(page).toHaveURL(new RegExp(`view=${view}`));
    await expect(page.getByRole("table")).toBeVisible();
  }

  await page.getByRole("link", { name: "Items", exact: true }).click();
  const orderBy: Record<string, string> = {};
  for (const [label, sort] of [["Adjusted score", "adjusted"], ["Win rate", "winRate"], ["Baseline delta", "baselineDelta"], ["Build rate", "buildRate"], ["Sample games", "sample"]] as const) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    if (sort !== "adjusted") await expect(page).toHaveURL(new RegExp(`sort=${sort}`));
    const values = await page.locator("tbody tr").evaluateAll((rows, column) => rows.map((row) => {
      const cell = row.querySelector(`[data-label="${column}"]`);
      const text = (cell?.textContent ?? "").replace("−", "-").replace("+", "");
      return Number(text.replace(/[^0-9.-]/g, ""));
    }), label);
    expect(values.length).toBeGreaterThan(1);
    expect(values).toEqual([...values].sort((left, right) => right - left));
    if (sort === "baselineDelta") expect(values[0]).toBeGreaterThan(values.at(-1)!);
    orderBy[sort] = await page.locator("tbody tr").first().innerText();
  }
  expect(orderBy.winRate).not.toBe(orderBy.sample);
});

test("keeps low-confidence rows opt-in", async ({ page }) => {
  await page.goto("/champions/jinx?role=BOTTOM&view=trios");
  await expect(page.getByText("Show low-confidence results")).toBeVisible();
  await expect(page.getByText("Low confidence")).toHaveCount(0);
  await page.getByRole("link", { name: "Show low-confidence results" }).click();
  await expect(page).toHaveURL(/lowConfidence=1/);
  await expect(page.getByText("Low confidence")).toBeVisible();
});

test("uses real Tab navigation in document order", async ({ page }) => {
  await page.goto("/");
  const expected = [
    page.getByRole("link", { name: "LoL Statistics" }),
    page.getByRole("link", { name: "Home" }),
    page.getByRole("link", { name: "Methodology" }),
    page.getByRole("link", { name: "Status" }),
    page.getByRole("searchbox", { name: "Search champions" })
  ];
  for (const locator of expected) {
    await page.keyboard.press("Tab");
    await expect(locator).toBeFocused();
  }
  await expected[4]!.fill("Jinx");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Jinx" })).toBeFocused();
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
