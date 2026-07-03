import { test, expect } from "@playwright/test";

test.describe("Purchase flow", () => {
  test("Open public event page and view purchase modal", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("event-public-title")).toHaveText("Concierto Acústico Demo");
    await expect(page.getByTestId("event-public-payment-methods")).toBeVisible();

    const buyBtn = page.locator("button").filter({ hasText: /Comprar/i }).first();
    await expect(buyBtn).toBeVisible();
    await buyBtn.click();

    await expect(page.getByTestId("purchase-modal")).toBeVisible({ timeout: 10_000 });
  });

  test("Purchase modal shows quantity input and payment methods", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });

    const buyBtn = page.locator("button").filter({ hasText: /Comprar/i }).first();
    await buyBtn.click();
    await expect(page.getByTestId("purchase-modal")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId("qty-input")).toBeVisible();
    await expect(page.getByTestId("payment-method-selector")).toBeVisible();
    await expect(page.getByTestId("buyer-name")).toBeVisible();
    await expect(page.getByTestId("buyer-email")).toBeVisible();
    await expect(page.getByTestId("promo-input")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("purchase-submit")).toBeVisible();
  });

  test("Promo code input and apply button present (#9 fix)", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");

    const buyBtn = page.locator("button").filter({ hasText: /Comprar/i }).first();
    await buyBtn.click();

    await expect(page.getByTestId("purchase-modal")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("promo-input")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("promo-apply")).toBeVisible();
  });

  test("Complete purchase with cash payment — full flow", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });

    const buyBtn = page.locator("button").filter({ hasText: /Comprar/i }).first();
    await buyBtn.click();
    await expect(page.getByTestId("purchase-modal")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("buyer-name").fill("Juan Pérez");
    await page.getByTestId("buyer-email").fill("juan@test.com");
    await page.getByTestId("buyer-doc").fill("1234567890");

    await page.getByTestId("payment-method-cash").click();
    await page.waitForTimeout(300);

    await page.getByTestId("purchase-submit").click();

    await expect(page).toHaveURL(/\/instrucciones|\/orden\//, { timeout: 15_000 });
  });
});
