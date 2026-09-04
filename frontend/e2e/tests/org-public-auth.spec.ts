import { test, expect } from "@playwright/test";

test.describe("Organizer public login / register", () => {
  test("Microsite and event pages show login and register", async ({ page }) => {
    await page.goto("/o/demo-org");
    await expect(page.getByTestId("org-public-auth-bar")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("event-public-login")).toBeVisible();
    await expect(page.getByTestId("org-public-register")).toBeVisible();

    await page.getByTestId("event-public-login").click();
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") || "")).toBe(
      "/o/demo-org",
    );

    await page.goto("/o/demo-org/e/concierto-acustico-demo");
    await expect(page.getByTestId("event-public-title")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("org-public-auth-bar")).toBeVisible();
    await expect(page.getByTestId("event-public-login")).toBeVisible();
    await expect(page.getByTestId("org-public-register")).toBeVisible();

    await page.getByTestId("org-public-register").click();
    await expect(page).toHaveURL(/\/registro-comprador\?next=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") || "")).toContain(
      "/o/demo-org/e/concierto-acustico-demo",
    );
  });

  test("Buyer logout returns to the organizer landing", async ({ page }) => {
    await page.goto("/o/demo-org");
    await expect(page.getByTestId("event-public-login")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("event-public-login").click();

    await page.getByTestId("login-email-input").fill("comprador@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Buyer123!");
    await page.getByTestId("login-submit-btn").click();

    await expect(page).toHaveURL(
      (url) => url.pathname === "/o/demo-org" || url.pathname === "/o/demo-org/",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("event-public-mis-entradas")).toBeVisible();

    await page.getByTestId("event-public-mis-entradas").click();
    await expect(page.getByTestId("buyer-logout")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("buyer-logout").click({ force: true });

    await expect(page).toHaveURL(
      (url) => url.pathname === "/o/demo-org" || url.pathname === "/o/demo-org/",
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("org-public-auth-bar")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("event-public-login")).toBeVisible();
    await expect(page.getByTestId("org-public-register")).toBeVisible();
  });
});
