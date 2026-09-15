import { test, expect } from "@playwright/test";

// TI-89: Fecha inicio / Fecha fin in "Vigencia y cupos" used a native
// <input type="datetime-local"> squeezed into a 2-column grid — cramped and
// hard to read. Now uses the same calendar-based DateTimePicker as the rest
// of the app (event dates, sales windows).
test("Vigencia y cupos uses the calendar DateTimePicker, not a cramped native datetime input", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
  await page.getByTestId("login-password-input").fill("Organizer123!");
  await page.getByTestId("login-submit-btn").click();
  await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

  await page.goto("/app/eventos");
  await page.getByTestId("event-detail-link-funcion-especial-demo-numerado").click();
  await page.getByTestId("event-edit-btn").click();
  await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("tab-discounts").click();
  await expect(page.getByTestId("section-discounts")).toBeVisible();
  await page.getByTestId("disc-rule-add").click();

  const fromPicker = page.getByTestId("rule-valid-from");
  await expect(fromPicker).toBeVisible();
  // A DateTimePicker renders as a <button> that opens a calendar popover —
  // a native datetime-local input has no such button/popover pairing.
  await expect(fromPicker).toHaveJSProperty("tagName", "BUTTON");
  await fromPicker.click();
  await expect(page.getByTestId("rule-valid-from-popover")).toBeVisible();
  await page.keyboard.press("Escape");

  const untilPicker = page.getByTestId("rule-valid-until");
  await expect(untilPicker).toHaveJSProperty("tagName", "BUTTON");
});
