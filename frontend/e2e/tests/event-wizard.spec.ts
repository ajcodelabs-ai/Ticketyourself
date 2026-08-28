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

  test("Localidades step has 4.1 escenario and 4.2 localidades substeps", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("tab-localidades").click();
    await expect(page.getByTestId("localidades-substeps")).toBeVisible();
    await expect(page.getByTestId("escenario-panel")).toBeVisible();

    await page.getByTestId("localidades-goto-localidades").click();
    await expect(page.getByTestId("localidades-panel")).toBeVisible();
  });

  // Regression coverage for client feedback (items 6, 7, 8):
  //   6. "Ventana de venta" must read as reservation window for free events,
  //      not just "compra" (sale) — the organizer was confused since a free
  //      event has nothing to "sell".
  //   7. The access-control copy must clarify it gates the event *page*
  //      (microsite), not physical entry to the event itself.
  //   8. Access types gated by plan (lista verificada / código) must be
  //      disabled for non-Enterprise plans so the organizer can't pick an
  //      option that the backend will 403 on save.
  test("Free events show a reservation-window hint, not just a sale-window one (feedback #6)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    // "free" is the default pricing type for a brand-new event.
    await expect(page.getByTestId("wiz-pricing-type")).toContainText("Gratuito");

    await page.getByTestId("tab-fechas").click();
    await expect(page.getByTestId("sales-window-block")).toContainText(
      "compra (o reserva si es gratuito)",
    );
  });

  test("Access control clarifies it gates the event page, not physical entry (feedback #7)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("tab-access").click();
    // The gating explanation is the section's intro copy, not the
    // Visibilidad sub-block — check the section as a whole.
    await expect(page.getByTestId("section-access")).toContainText("el evento en el microsite");
    await expect(page.getByTestId("section-access")).toContainText("QR");
  });

  test("Lista verificada and Código de acceso are plan-gated for Profesional (feedback #8)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("tab-access").click();
    await expect(page.getByTestId("section-access")).toBeVisible();

    // Demo organizer is on Profesional — these Enterprise-only options
    // must render disabled with an upgrade badge, not be selectable.
    const verified = page.getByTestId("access-type-verified_list");
    const accessCode = page.getByTestId("access-type-access_code");
    await expect(verified).toBeDisabled();
    await expect(accessCode).toBeDisabled();
    await expect(verified).toContainText("Disponible en");
    await expect(accessCode).toContainText("Disponible en");
    await expect(page.getByTestId("upgrade-plan-verified_lists")).toBeVisible();
    await expect(page.getByTestId("upgrade-plan-access_codes")).toBeVisible();

    // Open remains available; link_only / público bloqueado removed (PRD §4.2.2).
    await expect(page.getByTestId("access-type-open")).toBeEnabled();
    await expect(page.getByTestId("access-type-link_only")).toHaveCount(0);
    await expect(page.getByTestId("access-visibility-public_blocked")).toHaveCount(0);
    await expect(page.getByTestId("ticket-validation-qr")).toBeVisible();
    await expect(page.getByTestId("ticket-validation-none")).toBeVisible();
  });

  test("Multifunción modal only asks for name, description and schedule", async ({ page }) => {
    await page.route("**/api/plans/me/features", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({
        status: response.status(),
        json: { ...json, multi_function_events: true },
      });
    });

    await page.goto("/app/eventos");
    await page.getByTestId("event-detail-link-concierto-acustico-demo").click();
    await page.getByTestId("event-edit-btn").click();
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("tab-fechas").click();
    await page.getByTestId("event-structure-multi").click();
    await expect(page.getByTestId("section-functions")).toBeVisible();
    await page.getByTestId("add-function").click();

    await expect(page.getByTestId("fn-name")).toBeVisible();
    await expect(page.getByTestId("fn-starts")).toBeVisible();
    await expect(page.getByTestId("fn-ends")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Nueva función");
    await expect(page.getByRole("dialog")).toContainText("Descripción");
    await expect(page.getByTestId("fn-capacity")).toHaveCount(0);
    await expect(page.getByText("Lugar de esta función")).toHaveCount(0);
    await expect(page.getByText("Aforo de esta función")).toHaveCount(0);
    await expect(page.getByText("Orden de aparición")).toHaveCount(0);
    await expect(page.getByText("Precio y aforo por tipo de ticket")).toHaveCount(0);
    await expect(page.getByTestId("event-structure-subevent")).toHaveCount(0);
    await expect(page.getByText("Con subeventos")).toHaveCount(0);
  });

  test("Ticket design templates are A4 for email PDF", async ({ page }) => {
    await page.goto("/app/eventos");
    await page.getByTestId("event-detail-link-concierto-acustico-demo").click();
    await page.getByTestId("event-edit-btn").click();
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("tab-media").click();
    await page.getByTestId("media-goto-ticket").click();
    await expect(page.getByTestId("section-ticket-design")).toBeVisible();
    await expect(page.getByTestId("ticket-design-panel-main")).toContainText("A4");
    await expect(page.getByTestId("td-format-main")).toHaveCount(0);
    await page.getByTestId("td-template-clasico-main").click();
    const canvas = page.getByTestId("td-canvas-main");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box.height).toBeGreaterThan(box.width);
  });
});
