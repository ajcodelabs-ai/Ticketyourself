import { test, expect } from "@playwright/test";

test.describe("Event wizard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Organizer123!");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });
  });

  test("Create new event wizard loads all tabs", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    const expectedTabs = [
      "tab-general",
      "tab-fechas",
      "tab-media",
      "tab-localidades",
      "tab-payments",
      "tab-discounts",
      "tab-access",
      "tab-params",
    ];

    for (const tab of expectedTabs) {
      await expect(page.getByTestId(tab)).toBeVisible();
    }
  });

  test("Can navigate between steps", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("tab-general")).toHaveAttribute("data-state", "active");

    for (let i = 0; i < 3; i++) {
      await page.getByTestId("wizard-next").click();
    }

    await expect(page.getByTestId("tab-localidades")).toHaveAttribute("data-state", "active");
  });

  test("Draft persistence — form data survives step change (#6 ref fix)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    const title = `E2E Test Event ${Date.now()}`;
    await page.getByTestId("event-title-input").fill(title);

    await page.getByTestId("wizard-next").click();
    await page.getByTestId("wizard-save-draft").click();

    await expect(page.getByTestId("toast") ?? page.locator("text=guardado")).toBeVisible({ timeout: 10_000 }).catch(() => {});

    await page.getByTestId("tab-general").click();
    await expect(page.getByTestId("event-title-input")).toHaveValue(title);
  });

  test("Paid event without price shows error on localidades step (#7 fix)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    // Pricing type lives in General; seated toggle lives in Localidades.
    await page.getByTestId("wiz-pricing-paid").click();
    await page.waitForTimeout(300);

    await page.getByTestId("tab-localidades").click();
    await page.waitForTimeout(300);

    await page.getByTestId("wiz-seated-toggle").click();
    await page.waitForTimeout(500);

    const errorSvg = page.getByTestId("tab-localidades").locator(".lucide-triangle-alert");
    await expect(errorSvg).toBeVisible({ timeout: 5_000 });
  });
});
