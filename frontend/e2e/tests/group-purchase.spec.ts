import { test, expect } from "@playwright/test";

// TI-91: "Compra de fila / mesa completa" used to live in the General tab's
// advanced-content accordion, disconnected from the numbered-seating
// context it actually depends on, and shown unconditionally (even for
// unnumbered/GA events). It now lives in Localidades → 4.2, and only shows
// once the event has at least one numbered locality.
test("Compra de fila/mesa moved to Localidades, gated on having a numbered locality", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
  await page.getByTestId("login-password-input").fill("Organizer123!");
  await page.getByTestId("login-submit-btn").click();
  await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

  const token = await page.evaluate(() => localStorage.getItem("tys_access_token"));
  const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:8000";
  const created = await page.request.post(`${BACKEND_URL}/api/events/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: `TI-91 E2E ${Date.now()}`, pricing_type: "paid", base_price_cents: 1000, currency: "USD" },
  });
  const event = await created.json();

  await page.goto(`/app/eventos/${event.id}/editar`);
  await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

  // Not in General's advanced content — no numbered locality exists yet
  // (and it never belonged there in the first place).
  const advanced = page.getByText("Mostrar contenido avanzado");
  if (await advanced.isVisible().catch(() => false)) {
    await advanced.click();
  }
  await expect(page.getByTestId("section-group-purchase")).toHaveCount(0);

  // Link a venue with numbered rows and create a numbered locality.
  await page.getByTestId("tab-localidades").click();
  await expect(page.getByTestId("escenario-panel")).toBeVisible();
  await page.getByTestId("wiz-venue-select").click();
  await page.getByRole("option", { name: "Teatro Demo" }).click();
  await expect(page.getByTestId("venue-selected-badge")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("localidades-goto-localidades").click();
  await page.getByTestId("locality-add").click();
  await expect(page.getByTestId("locality-form-dialog")).toBeVisible();
  await page.getByTestId("locality-form-name").fill("Platea");
  await page.getByTestId("locality-form-price").fill("10");
  await page.getByTestId("locality-form-submit").click();
  await expect(page.getByTestId("locality-form-dialog")).not.toBeVisible({ timeout: 10_000 });

  // Now present, in Localidades — the event has a numbered locality.
  await expect(page.getByTestId("section-group-purchase")).toBeVisible();

  const toggle = page.getByTestId("content-allow-group-purchase");
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByText("Activado")).toBeVisible({ timeout: 5_000 });

  // Regression guard for the staleness bug code-review caught: this toggle
  // saves immediately (like its neighbor "¿Quién paga la comisión?"), but
  // the wizard's own form.content snapshot is taken at page load — without
  // EventWizard resyncing it on currentEvent.content changes, a later
  // "Guardar borrador" from any tab would silently send the stale
  // (unchecked) value and revert what was just confirmed on screen.
  await page.getByTestId("tab-general").click();
  await page.getByTestId("wizard-save-draft").click();
  await expect(page.getByText(/guardado/i)).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("tab-localidades").click();
  await page.getByTestId("tab-localidades-localidades").click();
  await expect(page.getByTestId("content-allow-group-purchase")).toHaveAttribute(
    "aria-checked",
    "true",
    { timeout: 10_000 },
  );

  await page.request.delete(`${BACKEND_URL}/api/events/me/${event.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
});
