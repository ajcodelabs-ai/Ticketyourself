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

  // Regression coverage for client feedback (items 6, 7, 8):
  //   6. "Ventana de venta" must read as reservation window for free events,
  //      not just "compra" (sale) — the organizer was confused since a free
  //      event has nothing to "sell".
  //   7. The access-control copy must clarify it gates the event *page*
  //      (microsite), not physical entry to the event itself.
  //   8. The wizard must not crash when picking "Lista verificada" as the
  //      access type (GuestListPanel used to blow up on a bad response shape
  //      and/or a missing access_params object).
  test("Free events show a reservation-window hint, not just a sale-window one (feedback #6)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    // "free" is the default pricing type for a brand-new event.
    await expect(page.getByTestId("wiz-pricing-type")).toContainText("Gratis");
    await expect(page.getByTestId("info-cuando-block")).toContainText(
      "compra (o reserva si es gratuito)",
    );
  });

  test("Access control clarifies it gates the event page, not physical entry (feedback #7)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("tab-access").click();
    await expect(page.getByTestId("access-control-block")).toContainText("página del evento");
    await expect(page.getByTestId("access-control-block")).toContainText("QR");
  });

  test("Selecting Lista verificada does not crash the wizard (feedback #8)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    const title = `E2E Guest List Event ${Date.now()}`;
    await page.getByTestId("event-title-input").fill(title);
    // Draft save requires a start date — fill it so the POST actually
    // succeeds and the wizard gets a real eventId (otherwise GuestListPanel
    // short-circuits to its "save the event first" placeholder and the
    // crash this test guards against never gets exercised).
    const startsAt = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
    await page.getByTestId("wiz-starts").fill(startsAt);
    await page.getByTestId("wizard-save-draft").click();
    await expect(page).toHaveURL(/\/app\/eventos\/.+\/editar/, { timeout: 10_000 });

    await page.getByTestId("tab-access").click();
    await page.getByTestId("access-type").click();
    await page.locator('[role="option"]').filter({ hasText: "Lista verificada" }).click();

    // Before the fix, a bad guest-list response shape (or an undefined
    // access_params on the form) threw during render and blanked the page.
    await expect(page.getByTestId("guest-list-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("event-wizard")).toBeVisible();
    await expect(page.getByTestId("guest-list-add-btn")).toBeVisible();
  });
});
