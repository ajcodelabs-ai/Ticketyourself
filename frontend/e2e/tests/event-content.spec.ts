import { test, expect } from "@playwright/test";

test.describe("Public event page", () => {
  test("Event page loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-page")).toBeVisible({ timeout: 15_000 });

    expect(errors.length).toBe(0);
  });

  test("Event page shows title, description, and payment methods", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("event-public-page")).toContainText("Concierto Acústico Demo");
    await expect(page.getByTestId("event-public-page")).toContainText("$15.00 USD");
    await expect(page.getByTestId("event-public-payment-methods")).toBeVisible();
  });
});
