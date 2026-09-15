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

  // Regression coverage: in the event-scoped map editor, the plain "Guardar"
  // toolbar button called the same `persist()` as "Listo" — both saved AND
  // navigated back to `return_to`, so there was no way to save progress and
  // keep editing a seat map; only the silent 30s autosave avoided the bounce.
  // Fixed by giving persist() a `navigateAway` flag that "Guardar" now opts
  // out of.
  test("Guardar in the event map editor saves without leaving the editor", async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Uncaught page exception: ${err.message}`);
    });

    const token = await page.evaluate(() => localStorage.getItem("tys_access_token"));
    const res = await page.request.get(
      `${BACKEND_URL}/api/events/me?search=${encodeURIComponent("Demo Numerado")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json();
    const event = (body.items || []).find(
      (e: { slug: string }) => e.slug === "funcion-especial-demo-numerado",
    );
    expect(event, "seeded demo numbered event not found").toBeTruthy();

    const returnTo = encodeURIComponent(`/app/eventos/${event.id}/editar?tab=localidades`);
    await page.goto(`/app/eventos/${event.id}/mapa?return_to=${returnTo}`);
    await expect(page.getByTestId("venue-editor-page")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("venue-save-btn").click();
    await expect(page.getByText("Mapa del evento guardado")).toBeVisible({ timeout: 5_000 });

    // The bug: this used to redirect to `returnTo` just like "Listo" does.
    await expect(page).toHaveURL(new RegExp(`/app/eventos/${event.id}/mapa`));
    await expect(page.getByTestId("venue-editor-page")).toBeVisible();
  });

  // TI-152: "Guardar" in the locality pricing dialog used to be active the
  // moment the dialog opened, with no way to tell whether there was
  // actually anything to save. It should read as disabled/gray until the
  // organizer changes something, and go back to disabled once the change is
  // undone.
  test("Guardar in the locality pricing dialog reflects pending changes, not just saving state", async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem("tys_access_token"));
    const created = await page.request.post(`${BACKEND_URL}/api/events/me`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: `TI-152 E2E ${Date.now()}` },
    });
    const event = await created.json();

    await page.goto(`/app/eventos/${event.id}/editar?tab=localidades`);
    await expect(page.getByTestId("escenario-panel")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("wiz-venue-select").click();
    await page.getByRole("option", { name: "Teatro Demo" }).click();
    await expect(page.getByTestId("venue-selected-badge")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("localidades-goto-localidades").click();
    await page.getByTestId("locality-add").click();
    await expect(page.getByTestId("locality-form-dialog")).toBeVisible();
    await page.getByTestId("locality-form-name").fill("General");
    await page.getByTestId("locality-form-submit").click();
    await expect(page.getByTestId("locality-form-dialog")).not.toBeVisible({ timeout: 10_000 });

    const editBtn = page.locator('[data-testid^="loc-edit-"]').first();
    await expect(editBtn).toBeEnabled({ timeout: 10_000 });
    await editBtn.click();
    await expect(page.getByTestId("locality-form-dialog")).toBeVisible();

    const submit = page.getByTestId("locality-form-submit");
    await expect(submit).toBeDisabled();

    await page.getByTestId("locality-form-name").fill("Localidad editada");
    await expect(submit).toBeEnabled();

    await page.getByTestId("locality-form-name").fill("General");
    await expect(submit).toBeDisabled();

    // A saved reserved_quota of 0 renders the field as "" (not "0") — typing
    // "0" back in must not read as a change, or Guardar would stay
    // permanently enabled for every locality with no reserved quota.
    await page.getByTestId("locality-form-reserved-quota").fill("0");
    await expect(submit).toBeDisabled();
  });

  // TI-92: pan was previously only reachable via Space+drag or middle-click,
  // both undiscoverable. Now there's a visible "Mover mapa" toolbar tool
  // (data-testid="tool-pan") that does the same thing. Verify it pans the
  // whole canvas (both elements shift by the same delta) rather than
  // accidentally selecting or dragging the element the drag started on top of.
  test("Pan tool moves the whole map without selecting or dragging elements", async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Uncaught page exception: ${err.message}`);
    });

    await page.goto("/app/venues");
    await expect(page.getByTestId("venues-list-page")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("venues-create-btn").click();
    await page.getByTestId("venue-start-blank").click();
    await page.getByTestId("venue-new-name").fill(`E2E Pan ${Date.now()}`);
    await page.getByTestId("venue-new-submit").click();
    await expect(page.getByTestId("venue-editor-page")).toBeVisible({ timeout: 10_000 });

    // ?blank=1 skips the overlay on first landing; revisit without it (like
    // the Venues list "Editor" link would) so it shows and can be dismissed.
    const venueIdEarly = page.url().match(/\/app\/venues\/([^/]+)\/editor/)?.[1];
    await page.goto(`/app/venues/${venueIdEarly}/editor`);
    await expect(page.getByTestId("venue-empty-canvas-overlay")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("venue-empty-canvas-dismiss").click();
    await expect(page.getByTestId("venue-empty-canvas-overlay")).not.toBeVisible();

    const canvas = page.locator("canvas").first();
    const box = (await canvas.boundingBox())!;

    const drawZone = async (cx: number, cy: number) => {
      await page.getByTestId("tool-zone").click();
      await page.mouse.click(box.x + cx, box.y + cy);
      await page.getByRole("button", { name: "Crear zona" }).click();
    };
    // Two zones, far apart — if both shift by the same amount after the
    // drag below, that proves the whole map panned, not just one element.
    // Reset zoom/pan to 1:1 before each draw: adding the first element
    // triggers a one-time auto-fit that rescales the view, which would
    // throw off the fixed pixel math below.
    await drawZone(100, 100); // spans (100,100)-(300,200), center (200,150)
    await page.getByTestId("zoom-reset").click();
    await drawZone(380, 300); // spans (380,300)-(580,400), center (480,350)
    await page.getByTestId("zoom-reset").click();
    await expect(page.getByText("2 elementos")).toBeVisible({ timeout: 5_000 });

    await page.mouse.click(box.x + 20, box.y + 20);
    await expect(page.getByTestId("properties-panel-empty")).toBeVisible();

    await page.getByTestId("tool-pan").click();
    await expect(canvas).toHaveCSS("cursor", "grab");

    // Drag starting ON TOP of the first zone — exercises both the pan
    // trigger and the element-drag-start guard that must yield to it.
    const dx = 80;
    const dy = 60;
    await page.mouse.move(box.x + 200, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 200 + dx, box.y + 150 + dy, { steps: 5 });
    await page.mouse.up();

    // Panning must not select or drag the element it started on top of.
    await expect(page.getByTestId("properties-panel-empty")).toBeVisible();

    await page.getByTestId("tool-select").click();

    // First zone's center moved by the pan delta.
    await page.mouse.click(box.x + 200 + dx, box.y + 150 + dy);
    await expect(page.getByTestId("properties-panel")).toBeVisible({ timeout: 5_000 });
    await page.mouse.click(box.x + 20, box.y + 20);
    await expect(page.getByTestId("properties-panel-empty")).toBeVisible();

    // Second, untouched zone moved by the same delta too.
    await page.mouse.click(box.x + 480 + dx, box.y + 350 + dy);
    await expect(page.getByTestId("properties-panel")).toBeVisible({ timeout: 5_000 });

    // That click also selected the second zone — its resize/rotate
    // Transformer anchors are now live at its corners. Switching to the
    // pan tool with a selection still active must detach them (they drag
    // independently of the element's own `draggable` gating), or a drag
    // starting on a corner resizes the zone instead of panning the map.
    // Ancho/Alto are the 4th/5th number inputs in the panel (X, Y,
    // Rotación, Ancho, Alto) — no dedicated testid on them.
    const numberInputs = page.getByTestId("properties-panel").locator('input[type="number"]');
    await expect(numberInputs.nth(3)).toHaveValue("200");
    await expect(numberInputs.nth(4)).toHaveValue("100");

    await page.getByTestId("tool-pan").click();
    await expect(canvas).toHaveCSS("cursor", "grab");
    const cornerX = box.x + 460; // zone2's shifted top-left corner
    const cornerY = box.y + 360;
    await page.mouse.move(cornerX, cornerY);
    await page.mouse.down();
    await page.mouse.move(cornerX + 40, cornerY + 30, { steps: 5 });
    await page.mouse.up();

    // Its stored dimensions must be untouched — a pan never mutates
    // element data, only the view.
    await expect(numberInputs.nth(3)).toHaveValue("200");
    await expect(numberInputs.nth(4)).toHaveValue("100");

    await page.getByTestId("tool-select").click();
    await page.mouse.click(box.x + 480 + dx + 40, box.y + 350 + dy + 30);
    await expect(page.getByTestId("properties-panel")).toBeVisible({ timeout: 5_000 });

    const venueId = page.url().match(/\/app\/venues\/([^/]+)\/editor/)?.[1];
    if (venueId) await archiveVenue(page, venueId);
  });
});
