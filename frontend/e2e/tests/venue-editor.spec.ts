import { test, expect, type Page } from "@playwright/test";

const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:8000";

// The demo organizer has a per-plan venue quota — archive whatever a test
// creates so repeated runs don't exhaust it and starve later tests.
async function archiveVenue(page: Page, venueId: string) {
  const token = await page.evaluate(() => localStorage.getItem("tys_access_token"));
  await page.request.post(`${BACKEND_URL}/api/venues/me/${venueId}/archive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test.describe("Venue editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Organizer123!");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });
  });

  // Regression coverage for client feedback: "pregunta por que cuando creo
  // un venue me lleva a una pagina en blanco". Root cause: VenueEditor.tsx
  // read `elements.length` in a useEffect dependency array before the
  // `const elements = venue?.elements || []` declaration further down the
  // component — a temporal-dead-zone ReferenceError on every render, which
  // (with no error boundary in the app) unmounted the whole page.
  test("Creating a blank venue lands on a working editor, not a blank page", async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Uncaught page exception: ${err.message}`);
    });

    await page.goto("/app/venues");
    await expect(page.getByTestId("venues-list-page")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("venues-create-btn").click();
    await page.getByTestId("venue-start-blank").click();

    const name = `E2E Venue ${Date.now()}`;
    await page.getByTestId("venue-new-name").fill(name);
    await page.getByTestId("venue-new-submit").click();

    await expect(page).toHaveURL(/\/app\/venues\/(.+)\/editor\?blank=1/, { timeout: 10_000 });
    await expect(page.getByTestId("venue-editor-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("venue-name-input")).toHaveValue(name);

    const venueId = page.url().match(/\/app\/venues\/([^/]+)\/editor/)?.[1];
    if (venueId) await archiveVenue(page, venueId);
  });

  test("Creating a venue from a template also lands on a working editor", async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Uncaught page exception: ${err.message}`);
    });

    await page.goto("/app/venues");
    await expect(page.getByTestId("venues-list-page")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("venues-create-btn").click();
    // Scoped to the open dialog's own VenueTemplatePicker — Venues.tsx also
    // renders a page-level "quick pick" template section behind the modal
    // with a similarly-prefixed testid (`use-template-*`), which is covered
    // by the dialog backdrop and would never be clickable.
    const dialog = page.getByRole("dialog");
    const templateBtn = dialog.locator('[data-testid^="pick-template-"]').first();
    await expect(templateBtn).toBeVisible({ timeout: 10_000 });
    await templateBtn.click();

    await expect(page).toHaveURL(/\/app\/venues\/.+\/editor/, { timeout: 10_000 });
    await expect(page.getByTestId("venue-editor-page")).toBeVisible({ timeout: 10_000 });

    const venueId = page.url().match(/\/app\/venues\/([^/]+)\/editor/)?.[1];
    if (venueId) await archiveVenue(page, venueId);
  });

  // Regression coverage for client feedback: "Uncaught TypeError:
  // crypto.randomUUID is not a function" thrown from LocalitiesPanel on
  // mount. crypto.randomUUID only exists in secure contexts (https, or the
  // literal "localhost" hostname) — over plain http on any other host (e.g.
  // lvh.me, a LAN IP, a staging domain without TLS) it's undefined, and
  // LocalitiesPanel calls it as a useState initializer, so it throws on
  // every single visit to the editor, not just when adding a locality.
  test("Editor still works when crypto.randomUUID is unavailable (insecure context)", async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-ignore — simulate a non-secure context (e.g. http://lvh.me)
      delete (window.crypto as any).randomUUID;
    });
    page.on("pageerror", (err) => {
      throw new Error(`Uncaught page exception: ${err.message}`);
    });

    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Organizer123!");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

    await page.goto("/app/venues");
    await expect(page.getByTestId("venues-list-page")).toBeVisible({ timeout: 10_000 });
    const editBtn = page.locator('[data-testid^="venue-edit-"]').first();
    await editBtn.click();
    await expect(page.getByTestId("venue-editor-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("localities-panel")).toBeVisible({ timeout: 5_000 });

    // Also exercise the explicit "add locality" path, which generates a
    // second id.
    await page.getByTestId("locality-add").click();
    await expect(page.getByTestId("locality-new-name")).toBeVisible({ timeout: 5_000 });
  });

  // Regression coverage for client feedback: "No me deja disenar mi propio
  // Venue, no puedo dibujar nada y me obliga a hacer click en una
  // plantilla." The empty-canvas overlay's dismiss (X) button and its
  // "Empezar en blanco" option were always wired correctly — this was really
  // a symptom of the two render crashes above (a blank/dead editor looks
  // exactly like "I can't draw anything"). Exercise the full path end to
  // end: dismiss the template overlay, pick a drawing tool, click the
  // canvas, and confirm the resulting config dialog actually adds an
  // element.
  test("Dismissing the template overlay lets the organizer draw a zone by hand", async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Uncaught page exception: ${err.message}`);
    });

    await page.goto("/app/venues");
    await expect(page.getByTestId("venues-list-page")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("venues-create-btn").click();
    await page.getByTestId("venue-start-blank").click();
    await page.getByTestId("venue-new-name").fill(`E2E Draw ${Date.now()}`);
    await page.getByTestId("venue-new-submit").click();
    await expect(page.getByTestId("venue-editor-page")).toBeVisible({ timeout: 10_000 });

    // Revisiting a blank venue's editor without ?blank=1 (e.g. from the
    // Venues list "Editor" link) re-shows the overlay every time — confirm
    // its dismiss control still works from that cold state too.
    const venueId = page.url().match(/\/app\/venues\/([^/]+)\/editor/)?.[1];
    expect(venueId).toBeTruthy();
    await page.goto(`/app/venues/${venueId}/editor`);
    await expect(page.getByTestId("venue-empty-canvas-overlay")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("venue-empty-canvas-dismiss").click();
    await expect(page.getByTestId("venue-empty-canvas-overlay")).not.toBeVisible();

    await page.getByRole("button", { name: "Zona" }).click();
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(page.getByRole("button", { name: "Crear zona" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Crear zona" }).click();

    await expect(page.getByText("1 elementos")).toBeVisible({ timeout: 5_000 });

    if (venueId) await archiveVenue(page, venueId);
  });
});
