import { test, expect } from "@playwright/test";

test.describe("Purchase flow", () => {
  test("Open public event page and view purchase modal auth gate", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("event-public-title")).toHaveText("Concierto Acústico Demo");
    await expect(page.getByTestId("event-public-payment-methods")).toBeVisible();

    const buyBtn = page.locator("button").filter({ hasText: /Comprar/i }).first();
    await expect(buyBtn).toBeVisible();
    await buyBtn.click();

    await expect(page.getByTestId("purchase-modal")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("buyer-auth-panel")).toBeVisible();
  });

  test("Registering in the modal reveals quantity and payment methods", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });

    const buyBtn = page.locator("button").filter({ hasText: /Comprar/i }).first();
    await buyBtn.click();
    await expect(page.getByTestId("purchase-modal")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("buyer-auth-panel")).toBeVisible();

    await page.getByTestId("buyer-auth-tab-register").click();
    const unique = Date.now();
    await page.getByTestId("auth-panel-name").fill("Comprador E2E");
    await page.getByTestId("auth-panel-email").fill(`e2e-buy-${unique}@example.com`);
    await page.getByTestId("auth-panel-password").fill("Buyer123!");
    await page.getByTestId("auth-panel-confirm").fill("Buyer123!");
    await page.getByTestId("auth-panel-submit").click();

    await expect(page.getByTestId("qty-input")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("payment-method-selector")).toBeVisible();
    await expect(page.getByTestId("buyer-name")).toBeVisible();
    await expect(page.getByTestId("buyer-email")).toBeVisible();
    await expect(page.getByTestId("buyer-email")).toBeDisabled();
    await expect(page.getByTestId("promo-input")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("purchase-submit")).toBeVisible();
  });

  test("Complete purchase with cash payment — full flow", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });

    const buyBtn = page.locator("button").filter({ hasText: /Comprar/i }).first();
    await buyBtn.click();
    await expect(page.getByTestId("purchase-modal")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("buyer-auth-tab-register").click();
    const unique = Date.now();
    await page.getByTestId("auth-panel-name").fill("Juan Pérez");
    await page.getByTestId("auth-panel-email").fill(`juan-e2e-${unique}@test.com`);
    await page.getByTestId("auth-panel-password").fill("Buyer123!");
    await page.getByTestId("auth-panel-confirm").fill("Buyer123!");
    await page.getByTestId("auth-panel-submit").click();

    await expect(page.getByTestId("purchase-submit")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("buyer-doc").fill("1710034065");
    await page.getByTestId("payment-method-cash").click();
    await page.waitForTimeout(300);
    await page.getByTestId("purchase-submit").click();

    await expect(page).toHaveURL(/\/instrucciones|\/orden\//, { timeout: 15_000 });
  });
});

test.describe("Buyer account", () => {
  test("Demo buyer can see tickets in /cuenta", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("comprador@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Buyer123!");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("cuenta-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("cuenta-tab-upcoming")).toBeVisible();
  });
});
