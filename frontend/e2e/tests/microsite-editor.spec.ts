import { test, expect, type Page } from "@playwright/test";

const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:8000";

async function getToken(page: Page): Promise<string> {
  return (await page.evaluate(() => localStorage.getItem("tys_access_token"))) as string;
}

async function getMicrosite(page: Page) {
  const token = await getToken(page);
  const res = await page.request.get(`${BACKEND_URL}/api/microsite/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function patchMicrositeContent(page: Page, content: Record<string, string | null>) {
  const token = await getToken(page);
  await page.request.put(`${BACKEND_URL}/api/microsite/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { content },
  });
}

test.describe("Microsite editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Organizer123!");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });
  });

  // Regression coverage: editing the hero title on the canvas fires two
  // pushUpdate calls in the same tick — onUpdateContent({hero_title}) then
  // onUpdateBlockProps(blockId, {layers}) (HeroBlockView.handleLayerUpdate in
  // MicrositeBlocks.tsx). pushUpdate used to share a single debounce timer and
  // only send the *last* call's payload, so the content patch's network PUT
  // got silently cancelled by the blocks patch scheduled right after it — the
  // title looked saved in the UI but reverted on reload. Fixed by having
  // pushUpdate accumulate pending partials instead of overwriting them.
  test("Editing the hero title on the canvas persists after reload", async ({ page }) => {
    page.on("pageerror", (err) => {
      throw new Error(`Uncaught page exception: ${err.message}`);
    });

    const original = await getMicrosite(page);
    const originalTitle = original.content?.hero_title ?? "";

    try {
      await page.goto("/app/microsite");
      await expect(page.getByTestId("microsite-editor")).toBeVisible({ timeout: 15_000 });

      const newTitle = `E2E Hero Title ${Date.now()}`;
      const titleField = page.getByTestId("ms-hero-title");
      await titleField.click();
      await page.getByTestId("ms-hero-title").fill(newTitle);
      await page.getByTestId("ms-hero-title").press("Tab"); // blur → commits + schedules save

      // Debounced save is 300ms — give it margin before reloading.
      await page.waitForTimeout(1000);

      await page.reload();
      await expect(page.getByTestId("microsite-editor")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ms-hero-title")).toHaveText(newTitle);
    } finally {
      await patchMicrositeContent(page, { hero_title: originalTitle });
    }
  });

  // Regression coverage: pushUpdate's debounced save unconditionally did
  // setMicrosite(data) with the PUT response. Typing continuously means a
  // save can still be in flight when newer keystrokes have already queued
  // in pendingPartial — applying that older response clobbered the newer
  // local text, dropping words. Fixed by only applying a save response when
  // no newer save/edit has superseded it (MicrositeEditor.tsx pushUpdate).
  test("Typing continuously through an autosave round-trip doesn't drop words", async ({ page }) => {
    const original = await getMicrosite(page);
    const originalSubtitle = original.content?.hero_subtitle ?? "";
    const sentence = "Esta es una oracion larga escrita sin pausas para probar el autoguardado";

    // Widen the race window: real network latency is usually shorter than a
    // human's inter-word typing gap, so without this the bug is flaky to hit.
    await page.route(`${BACKEND_URL}/api/microsite/me`, async (route) => {
      if (route.request().method() === "PUT") {
        await new Promise((r) => setTimeout(r, 600));
      }
      await route.continue();
    });

    try {
      await page.goto("/app/microsite");
      await expect(page.getByTestId("microsite-editor")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("setup-section-copy").getByRole("button").click();

      const field = page.getByTestId("quick-hero-subtitle");
      await field.click();
      await field.fill("");
      for (const word of sentence.split(" ")) {
        await field.pressSequentially(`${word} `, { delay: 30 });
        await page.waitForTimeout(500); // natural inter-word gap, safely > the 300ms debounce
      }

      await expect(field).toHaveValue(`${sentence} `);

      // Let the final debounced save (300ms) + its artificially delayed
      // PUT (600ms above) actually land before reloading, with margin for
      // a loaded CI runner.
      await page.waitForTimeout(2500);

      await page.reload();
      await expect(page.getByTestId("microsite-editor")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("setup-section-copy").getByRole("button").click();
      await expect(page.getByTestId("quick-hero-subtitle")).toHaveValue(`${sentence} `);
    } finally {
      await patchMicrositeContent(page, { hero_subtitle: originalSubtitle });
    }
  });

  test("Picking a template from the gallery applies colors and keeps the title", async ({ page }) => {
    const original = await getMicrosite(page);
    try {
      await page.goto("/app/microsite");
      await expect(page.getByTestId("quick-setup-panel")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("open-template-gallery").click();
      await expect(page.getByTestId("template-gallery")).toBeVisible();
      await page.getByTestId("template-card-evento_unico").click();
      await expect(page.getByTestId("color-primary")).toHaveValue("#9f1239");
      await page.getByTestId("setup-section-copy").getByRole("button").click();
      await expect(page.getByTestId("quick-hero-title")).toHaveValue(original.content?.hero_title || "");
    } finally {
      const token = await getToken(page);
      await page.request.put(`${BACKEND_URL}/api/microsite/me`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          template: original.template,
          branding: original.branding,
          content: original.content,
          blocks: original.blocks,
        },
      });
    }
  });

  // Regression coverage: the hero CTA button's href was organizer-controlled
  // free text with no protocol validation (HeroLayerItem.tsx `scrollOrNavigate`)
  // — a `javascript:` href executed via `window.open(href, "_self", ...)` on
  // every public visitor's click (stored XSS). A backend allowlist was also
  // added (services/microsite_blocks.safe_href), but this test intercepts the
  // public API response to inject the payload directly into what the browser
  // receives — so it verifies the *frontend* guard specifically, independent
  // of whether the backend sanitizer runs.
  test("A javascript: CTA href never reaches window.open on the public page", async ({ page }) => {
    await page.route(`${BACKEND_URL}/api/public/microsite/**`, async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.content = { ...(json.content || {}), hero_cta_href: "javascript:window.__xssFired=true" };
      await route.fulfill({ response, json });
    });

    await page.addInitScript(() => {
      (window as any).__openCalls = [];
      window.open = ((...args: unknown[]) => {
        (window as any).__openCalls.push(args);
        return null;
      }) as typeof window.open;
    });
    page.on("pageerror", (err) => {
      throw new Error(`Uncaught page exception on public microsite: ${err.message}`);
    });

    await page.goto("/o/demo-org");
    const cta = page.getByTestId("ms-hero-cta");
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await cta.click();

    const openCalls = await page.evaluate(() => (window as any).__openCalls);
    expect(openCalls.length).toBe(0);
    expect(page.url()).toContain("/o/demo-org");
  });
});

test.describe("Public microsite events", () => {
  // Regression: the events section used id={`block-${uuid}`} while the hero CTA
  // href is `#events`, so "Ver próximos eventos" was a no-op and the list
  // (below the about block) looked missing.
  test("Hero CTA scrolls to published events", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await page.goto("/o/demo-org");

    const events = page.getByTestId("ms-events-section");
    await expect(events).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-testid^='event-card-']").first()).toBeVisible();

    const cta = page.getByTestId("ms-hero-cta");
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(events).toBeInViewport();
  });
});
