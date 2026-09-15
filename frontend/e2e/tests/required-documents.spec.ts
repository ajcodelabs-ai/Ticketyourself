import { test, expect } from "@playwright/test";

// TI-82: only Ecuador had a per-country RequiredDocumentSet — every other
// country (Colombia included) fell through to the global default of just
// one doc_type, so a Colombia organizer could clear onboarding after
// uploading a single file, with no indication of what was actually
// required for their country + org type. Colombia now has its own set
// (backend/seeds.py `_seed_required_documents`), and the onboarding
// checklist shows required vs optional doc types explicitly.
test("Colombia company org sees its own required + optional doc checklist, not Ecuador's or the 1-doc global default", async ({ page }) => {
  const email = `co-ui-${Date.now()}@example.com`;
  const slug = `co-ui-${Date.now()}`;

  await page.goto("/register");
  await page.getByTestId("plan-card-profesional-cta").click();
  await expect(page.getByTestId("register-page")).toBeVisible();

  await page.getByTestId("register-country-select").click();
  await page.getByRole("option", { name: "Colombia" }).click();
  await page.getByTestId("register-orgtype").getByText("Empresa").click();
  await page.getByTestId("register-email-input").fill(email);
  // The phone widget's own country flag selector is independent from "País"
  // above and locks the dial code — must be switched separately, or the
  // dial code stays on the PhoneInput default (EC) and validation fails.
  await page.getByRole("combobox", { name: "Phone number country" }).selectOption("CO");
  await page.getByTestId("register-phone-input").fill("3001234567");
  await page.getByTestId("register-password-input").fill("Password123!");
  await page.getByTestId("register-confirm-input").fill("Password123!");
  await page.getByTestId("register-company-input").fill(`CO UI Test ${Date.now()}`);
  await page.getByTestId("register-legal-input").fill("900123456");
  await page.getByTestId("register-slug-input").fill(slug);
  await expect(page.getByTestId("register-slug-feedback")).toContainText("disponible", {
    timeout: 10_000,
  });
  await page.getByTestId("register-submit-btn").click();

  await expect(page.getByTestId("onboarding-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("required-docs-checklist")).toBeVisible();

  await expect(page.getByTestId("required-doc-ruc")).toBeVisible();
  await expect(page.getByTestId("required-doc-bank_certificate")).toBeVisible();
  await expect(page.getByTestId("required-doc-legal_rep_appointment")).toBeVisible();
  // enabling_docs is required for an EC company but NOT for CO — asserting
  // its absence here is what actually pins the country-specific set,
  // rather than a coincidental EC/global overlap.
  await expect(page.getByTestId("required-doc-enabling_docs")).toHaveCount(0);

  await expect(page.getByTestId("optional-docs-checklist")).toBeVisible();
  await expect(page.getByTestId("optional-doc-enabling_docs")).toBeVisible();
  await expect(page.getByTestId("optional-doc-id_card")).toBeVisible();
});
