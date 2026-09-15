import { test, expect } from "@playwright/test";

// TI-81: uploading a second file for a doc_type that already has one used to
// show both as equal, unlabeled rows — no way to tell which one the
// Superadmin should consider valid. The organizer's own upload page now
// reuses the same current/previous grouping the admin review panel already
// had (TI-78's groupDocumentsByType).
test("Uploading a second file for the same doc_type shows current vs previous, not two equal rows", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email-input").fill("prueba@ticketyourself.com");
  await page.getByTestId("login-password-input").fill("Organizer123!");
  await page.getByTestId("login-submit-btn").click();
  await page.waitForURL(/\/app\//, { timeout: 15_000 });

  await page.goto("/onboarding");
  await expect(page.getByTestId("docs-list")).toBeVisible({ timeout: 15_000 });

  // Don't assume an exact starting count (shared seeded organizer) — just
  // capture it, and use a run-unique filename so cleanup can't accidentally
  // target the wrong row if a prior run's file was ever left behind.
  const rows = page.locator('[data-testid^="doc-row-"]');
  const startCount = await rows.count();
  const filename = `ruc-v2-${Date.now()}.pdf`;

  await page.getByTestId("doc-type-select").click();
  await page.getByTestId("doc-type-option-ruc").click();
  await page.getByTestId("doc-file-input").setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake ruc v2"),
  });
  await page.getByTestId("doc-submit-btn").click();

  await expect(page.getByTestId("doc-group-ruc")).toBeVisible({ timeout: 15_000 });
  await expect(rows).toHaveCount(startCount + 1);
  await expect(page.getByTestId("doc-group-ruc")).toContainText("Versión anterior");

  // The just-uploaded file is the newest, so it renders as "current" (first
  // in the group), with the pre-existing "ruc" doc pushed to "previous".
  const uploadedRow = rows.filter({ hasText: filename });
  await expect(uploadedRow).toHaveCount(1);
  await uploadedRow.locator('[data-testid^="delete-doc-"]').click();
  await expect(rows).toHaveCount(startCount);
  await expect(page.getByText(filename)).toHaveCount(0);
});
