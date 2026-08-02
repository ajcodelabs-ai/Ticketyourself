import { test, expect } from "@playwright/test";

// Regression test for a timezone bug in backend/seeds.py: demo events were
// seeded by calling `.replace(hour=X)` directly on a UTC-aware datetime,
// which sets the *UTC* hour instead of the intended America/Guayaquil
// (UTC-5) local hour — every seeded event displayed 5 hours earlier than
// its intended start time (e.g. a 9pm show showed up as 4pm).
test.describe("Public event page — displayed date/time", () => {
  test("Concierto Acústico Demo shows its seeded local time (9:00 p.m.)", async ({ page }) => {
    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("event-public-page")).toContainText(/09:00\s*p\.?\s*m\.?/i);
  });

  test("Conferencia de Marketing Digital shows its seeded local time (9:00 a.m.)", async ({ page }) => {
    await page.goto("/o/demo-org/e/conferencia-marketing-digital");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("event-public-page")).toContainText(/09:00\s*a\.?\s*m\.?/i);
  });

  test("Charla Gratuita: Liderazgo Femenino shows its seeded local time (6:30 p.m.)", async ({ page }) => {
    await page.goto("/o/demo-org/e/charla-liderazgo-femenino");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("event-public-page")).toContainText(/06:30\s*p\.?\s*m\.?/i);
  });
});
