import { test, expect } from "@playwright/test";

const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:8000";

// TI-79: the Superadmin document review card already showed a readable
// type label ("RUC", "Cédula", …) for the current/vigente version of each
// document (TI-78), but a previous/older version — nested under it after a
// re-upload — got no typeLabel at all, so it rendered only the raw filename
// with no way to tell which requirement it belonged to.
test("Superadmin sees a readable doc type label on a previous document version, not just the filename", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email-input").fill("prueba@ticketyourself.com");
  await page.getByTestId("login-password-input").fill("Organizer123!");
  await page.getByTestId("login-submit-btn").click();
  await page.waitForURL(/\/app\//, { timeout: 15_000 });

  await page.goto("/onboarding");
  await expect(page.getByTestId("docs-list")).toBeVisible({ timeout: 15_000 });

  const filename = `ruc-ti79-${Date.now()}.pdf`;
  await page.getByTestId("doc-type-select").click();
  await page.getByTestId("doc-type-option-ruc").click();
  await page.getByTestId("doc-file-input").setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake ruc"),
  });
  await page.getByTestId("doc-submit-btn").click();
  await expect(page.getByTestId("doc-group-ruc")).toBeVisible({ timeout: 15_000 });

  // Capture the org's own token + the new doc's id now, so cleanup below
  // doesn't depend on the admin session or on the rest of the test passing.
  const orgToken = await page.evaluate(() => localStorage.getItem("tys_access_token"));
  const uploadedRowId = await page
    .locator('[data-testid^="doc-row-"]')
    .filter({ hasText: filename })
    .getAttribute("data-testid");
  const uploadedDocId = uploadedRowId?.replace("doc-row-", "");
  expect(uploadedDocId).toBeTruthy();

  try {
    await page.getByTestId("org-desktop-header").getByTestId("org-user-menu").click();
    await page.getByTestId("user-menu-logout").click();
    await expect(page.getByTestId("login-page")).toBeVisible({ timeout: 10_000 });

    await page.goto("/admin/login");
    await page.getByTestId("admin-login-email-input").fill("admin@ticketyourself.com");
    await page.getByTestId("admin-login-password-input").fill("Admin123!");
    await page.getByTestId("admin-login-submit-btn").click();
    await page.waitForURL(/\/admin$/, { timeout: 15_000 });

    await page.goto("/admin/organizadores");
    await expect(page.getByTestId("admin-organizers-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("admin-orgs-search").fill("prueba-eventos");
    const viewLink = page.getByTestId("org-view-prueba-eventos");
    await expect(viewLink).toBeVisible({ timeout: 10_000 });
    await page.goto((await viewLink.getAttribute("href")) as string);
    await expect(page.getByTestId("admin-org-detail")).toBeVisible({ timeout: 10_000 });

    const group = page.getByTestId("admin-doc-group-ruc");
    await expect(group).toBeVisible();
    // The newest upload is "current" (shown at the top, unindented); the
    // seeded "ruc_prueba.pdf" is now "previous". Match by that filename,
    // not a bare "starts with admin-doc-previous-" wildcard — a leftover
    // extra version from an earlier failed run would make the wildcard
    // match more than one row and fail strict mode instead of the actual
    // assertion.
    const previousRow = group
      .locator('[data-testid^="admin-doc-previous-"]')
      .filter({ hasText: "ruc_prueba.pdf" });
    await expect(previousRow).toHaveCount(1);
    await expect(previousRow).toContainText("RUC");
  } finally {
    // Runs even if an assertion above threw, so a failed run never leaves
    // the shared seeded organizer with an extra "ruc" version — this same
    // org/doc_type is also used by organizer-documents.spec.ts.
    const res = await page.request.delete(
      `${BACKEND_URL}/api/organizers/me/documents/${uploadedDocId}`,
      { headers: { Authorization: `Bearer ${orgToken}` } },
    );
    expect(res.ok()).toBeTruthy();
  }
});
