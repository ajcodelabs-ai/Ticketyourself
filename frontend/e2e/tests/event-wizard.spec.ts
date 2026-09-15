import { test, expect, Page } from "@playwright/test";

// Shared by every DateTimePicker instance (main event date, función Inicio/
// Fin — TI-155 made them consistent). Sets today's date via the calendar's
// "today" modifier classes (see components/ui/calendar.tsx day_today
// override), unambiguous regardless of which days the current month view
// shows as outside-month, plus an explicit hour/minute.
async function pickTodayDateTime(page: Page, testid: string, hour: string, minute: string) {
  await page.getByTestId(testid).click();
  const popover = page.getByTestId(`${testid}-popover`);
  await popover.locator("button.bg-accent.text-accent-foreground").click();
  await popover.getByTestId(`${testid}-hour`).click();
  await page.getByRole("option", { name: hour, exact: true }).click();
  await popover.getByTestId(`${testid}-minute`).click();
  await page.getByRole("option", { name: minute, exact: true }).click();
  await popover.getByTestId(`${testid}-done`).click();
}

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

  test("Mín./Máx. por orden can't be typed down to 0 (TI-150)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("tab-fechas").click();
    await expect(page.getByTestId("sales-config-block")).toBeVisible();

    const min = page.getByTestId("access-min-purchase");
    await min.fill("0");
    await min.blur();
    await expect(min).toHaveValue("1");

    const max = page.getByTestId("access-max-purchase");
    await max.fill("0");
    await max.blur();
    await expect(max).toHaveValue("1");
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

  test("Evento único stays blocked while functions exist, and persists once they're gone (TI-115)", async ({ page }) => {
    // Demo org's seeded plan doesn't include multi_function_events — mock both
    // the frontend gate and the backend's own plan-gated /functions endpoints
    // (same trick the "Multifunción modal" test above uses for the UI gate;
    // here we also need real POST/DELETE round-trips, which the real backend
    // would 403 on this plan, so a tiny in-memory fake stands in for it).
    await page.route("**/api/plans/me/features", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      await route.fulfill({
        status: response.status(),
        json: { ...json, multi_function_events: true },
      });
    });

    let fakeFunctions: any[] = [];
    await page.route(/\/api\/events\/me\/[^/]+\/functions(\/.*)?$/, async (route) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET") {
        await route.fulfill({ status: 200, json: fakeFunctions });
      } else if (method === "POST") {
        const body = req.postDataJSON();
        const fn = { id: `fake-${fakeFunctions.length + 1}`, tickets_sold: 0, status: "active", ...body };
        fakeFunctions.push(fn);
        await route.fulfill({ status: 201, json: fn });
      } else if (method === "DELETE") {
        const id = req.url().split("/functions/")[1];
        fakeFunctions = fakeFunctions.filter((f) => f.id !== id);
        await route.fulfill({ status: 204, body: "" });
      } else {
        await route.continue();
      }
    });

    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("event-title-input").fill(`TI-115 E2E ${Date.now()}`);

    await page.getByTestId("tab-fechas").click();
    await page.getByTestId("event-structure-multi").click();
    await page.getByTestId("wizard-save-draft").click();
    await page.waitForURL(/\/app\/eventos\/.+\/editar/, { timeout: 15_000 });

    await page.getByTestId("add-function").click();
    await page.getByTestId("fn-name").fill("Función E2E");
    await pickTodayDateTime(page, "fn-starts", "20", "00");
    await pickTodayDateTime(page, "fn-ends", "23", "00");
    await page.getByTestId("fn-save").click();
    await expect(page.getByTestId("fn-save")).toHaveCount(0);

    await expect(page.getByTestId("event-structure-single")).toBeDisabled();
    await expect(page.getByText("Eliminá las funciones existentes primero")).toBeVisible();

    const deleteFnBtn = page.locator('[data-testid^="fn-delete-"]');
    page.once("dialog", (dialog) => dialog.accept());
    await deleteFnBtn.click();

    await expect(page.getByTestId("event-structure-single")).toBeEnabled();
    await page.getByTestId("event-structure-single").click();
    await page.getByTestId("wizard-save-draft").click();

    await page.reload();
    await page.getByTestId("tab-fechas").click();
    await expect(page.getByTestId("event-structure-single")).toBeEnabled();
    await expect(
      page.getByTestId("event-structure-single").getByText("Activo"),
    ).toBeVisible();
  });

  test("Fechas y ventas header shows a formatted date, not raw ISO text (TI-155)", async ({ page }) => {
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("tab-fechas").click();

    await pickTodayDateTime(page, "wiz-starts", "20", "00");

    // Was `form.starts_at.replace("T", " ")` — a raw "YYYY-MM-DD HH:mm" string,
    // e.g. "2026-09-15 20:00". Now formatted via date-fns, which never
    // renders the raw "YYYY-MM-DD" date part.
    const summary = page.getByTestId("section-fechas");
    await expect(summary).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    await expect(summary).toContainText("20:00");
  });

  test("Clearing a custom sales-window date falls back to a real preset (TI-155)", async ({ page }) => {
    // Regression guard: preset="custom" + an empty custom date used to save
    // fine (computeSalesStart/computeSalesEnd silently return null = "sin
    // restricción") and only got caught by validation at publish time, not
    // draft-save. The "Quitar" button on DateTimePicker made this easier to
    // reach, so clearing now resets the preset instead of leaving it dangling.
    await page.goto("/app/eventos/nuevo");
    await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("tab-fechas").click();
    await pickTodayDateTime(page, "wiz-starts", "20", "00");

    await page.getByTestId("wiz-sales-start-preset").click();
    await page.getByRole("option", { name: "Fecha y hora personalizada" }).first().click();
    await expect(page.getByTestId("wiz-sales-start-custom")).toBeVisible();

    await pickTodayDateTime(page, "wiz-sales-start-custom", "10", "00");
    await page.getByTestId("wiz-sales-start-custom").click();
    await page.getByTestId("wiz-sales-start-custom-popover").getByTestId("wiz-sales-start-custom-clear").click();

    // The custom field disappears — the preset fell back to a real value,
    // not left as "custom" with nothing in it.
    await expect(page.getByTestId("wiz-sales-start-custom")).toHaveCount(0);
  });

  test("Función end date before start date is rejected (TI-155)", async ({ page }) => {
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
    await page.getByTestId("add-function").click();

    await page.getByTestId("fn-name").fill("Función con horario inválido");
    await pickTodayDateTime(page, "fn-starts", "23", "00");
    await pickTodayDateTime(page, "fn-ends", "20", "00");
    await page.getByTestId("fn-save").click();

    await expect(page.getByText("La fecha fin debe ser posterior a la fecha de inicio.")).toBeVisible();
    // Dialog stays open — nothing was saved.
    await expect(page.getByTestId("fn-save")).toBeVisible();

    // The old native <input type="datetime-local"> could be cleared back to
    // "" (no end date — falls back to the default 1h duration for overlap
    // checks). DateTimePicker's calendar has no such affordance by default,
    // so it needs an explicit "Quitar" action once a date is picked (TI-155).
    await page.getByTestId("fn-ends").click();
    await page.getByTestId("fn-ends-popover").getByTestId("fn-ends-clear").click();
    await expect(page.getByTestId("fn-ends")).toContainText("Elegí fecha y hora");
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
