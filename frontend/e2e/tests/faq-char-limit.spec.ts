import { test, expect } from "@playwright/test";

// TI-88: the FAQ answer field (a TipTap rich-text editor) had no character
// limit or counter — an organizer could paste an arbitrarily long answer
// with no feedback. 500 chars matches the cap already used for other
// description-style fields (backend/models.py).
test("FAQ answer blocks typing past 500 characters and shows a live counter", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
  await page.getByTestId("login-password-input").fill("Organizer123!");
  await page.getByTestId("login-submit-btn").click();
  await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

  const token = await page.evaluate(() => localStorage.getItem("tys_access_token"));
  const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:8000";
  const created = await page.request.post(`${BACKEND_URL}/api/events/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: `TI-88 E2E ${Date.now()}`, pricing_type: "paid", base_price_cents: 1000, currency: "USD" },
  });
  const event = await created.json();

  await page.goto(`/app/eventos/${event.id}/editar`);
  await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

  const advanced = page.getByText("Mostrar contenido avanzado");
  if (await advanced.isVisible().catch(() => false)) {
    await advanced.click();
  }
  await page.getByTestId("content-faq-add").click();
  const answer = page.getByTestId("content-faq-answer-0");
  await expect(answer).toBeVisible();

  // page.keyboard.type() dispatches real per-character input events, which
  // is what ProseMirror's transaction pipeline (and CharacterCount's
  // filterTransaction limit) actually listens to — page.fill()/insertText()
  // on a contenteditable don't reliably reach it.
  await answer.locator(".ProseMirror").click();
  await page.keyboard.type("a".repeat(600), { delay: 0 });

  const counter = page.getByTestId("content-faq-answer-0-char-count");
  await expect(counter).toHaveText("500 / 500");
  const text = await answer.locator(".ProseMirror").textContent();
  expect(text?.length).toBe(500);

  await page.request.delete(`${BACKEND_URL}/api/events/me/${event.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
});

// Regression guard: CharacterCount's default `autoTrim: true` deletes from
// the START of any content already over the limit the first time the editor
// mounts/receives a transaction (even just a click) — so an answer written
// before this limit existed would get silently corrupted the moment an
// organizer opened it, with the truncated text then saved back via
// onChange. Verified live: reverting `autoTrim: false` made this test fail
// (700 chars silently cut to 501 on click) before restoring the fix.
test("Opening a pre-existing over-limit FAQ answer does not silently truncate it", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
  await page.getByTestId("login-password-input").fill("Organizer123!");
  await page.getByTestId("login-submit-btn").click();
  await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

  const token = await page.evaluate(() => localStorage.getItem("tys_access_token"));
  const BACKEND_URL = process.env.VITE_BACKEND_URL || "http://localhost:8000";
  const created = await page.request.post(`${BACKEND_URL}/api/events/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: `TI-88 autotrim E2E ${Date.now()}`, pricing_type: "paid", base_price_cents: 1000, currency: "USD" },
  });
  const event = await created.json();
  await page.request.put(`${BACKEND_URL}/api/events/me/${event.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      content: {
        faq: [{ id: "faq1", question: "Pre-existing long answer", answer_html: `<p>${"a".repeat(700)}</p>` }],
      },
    },
  });

  await page.goto(`/app/eventos/${event.id}/editar`);
  await expect(page.getByTestId("event-wizard")).toBeVisible({ timeout: 15_000 });

  const advanced = page.getByText("Mostrar contenido avanzado");
  if (await advanced.isVisible().catch(() => false)) {
    await advanced.click();
  }

  const answer = page.getByTestId("content-faq-answer-0");
  await expect(answer).toBeVisible();
  // Click into the editor — exactly the focus/selection transaction that
  // autoTrim used to fire its silent delete on.
  await answer.locator(".ProseMirror").click();

  const counter = page.getByTestId("content-faq-answer-0-char-count");
  await expect(counter).toHaveText("700 / 500");
  const text = await answer.locator(".ProseMirror").textContent();
  expect(text?.length).toBe(700);

  await page.request.delete(`${BACKEND_URL}/api/events/me/${event.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
});
