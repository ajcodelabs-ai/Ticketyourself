import { test, expect } from "@playwright/test";

test.describe("Auth flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Organizer123!");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });
  });

  test("Login with demo account and verify dashboard", async ({ page }) => {
    await expect(page.getByTestId("dash-create-event")).toBeVisible();
    await expect(page.getByTestId("nav-events")).toBeVisible();
  });

  test("Sidebar navigation works after login", async ({ page }) => {
    await page.getByTestId("nav-venues").click();
    await expect(page).toHaveURL(/\/app\/venues/);

    await page.getByTestId("nav-events").click();
    await expect(page).toHaveURL(/\/app\/eventos/);

    await page.getByTestId("nav-dashboard").click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
  });

  test("Logout clears session", async ({ page }) => {
    await page.getByTestId("org-desktop-header").getByTestId("org-user-menu").click();
    await page.getByTestId("user-menu-logout").click();

    await expect(page.getByTestId("login-page")).toBeVisible({ timeout: 10_000 });
  });
});

// Regression coverage for the qodo-code-review findings on PR #12:
// the refresh token must be persisted (not memory-only) so the axios
// 401 interceptor can silently refresh after a reload, and a logout in
// one tab must revoke the session in every other open tab.
test.describe("Token persistence & cross-tab session", () => {
  test("Refresh token survives reload and re-authenticates an expired access token", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("demo@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Organizer123!");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

    const refreshToken = await page.evaluate(() => localStorage.getItem("tys_refresh_token"));
    expect(refreshToken).toBeTruthy();

    // Simulate an expired/invalid access token, as if 30 min had passed.
    await page.evaluate(() => localStorage.setItem("tys_access_token", "expired.invalid.token"));
    await page.reload();

    // checkSession() hits /auth/me with the bad token, gets a 401, and the
    // response interceptor must use the persisted refresh token to recover —
    // this is the exact flow that broke when the refresh token lived only
    // in a JS variable and was wiped on reload.
    await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

    const newAccessToken = await page.evaluate(() => localStorage.getItem("tys_access_token"));
    expect(newAccessToken).not.toBe("expired.invalid.token");
  });

  test("Logout in one tab ends the session in another open tab", async ({ context }) => {
    const tabA = await context.newPage();
    await tabA.goto("/login");
    await tabA.getByTestId("login-email-input").fill("demo@ticketyourself.com");
    await tabA.getByTestId("login-password-input").fill("Organizer123!");
    await tabA.getByTestId("login-submit-btn").click();
    await expect(tabA.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

    const tabB = await context.newPage();
    await tabB.goto("/app/dashboard");
    await expect(tabB.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });

    await tabA.getByTestId("org-desktop-header").getByTestId("org-user-menu").click();
    await tabA.getByTestId("user-menu-logout").click();
    await expect(tabA.getByTestId("login-page")).toBeVisible({ timeout: 10_000 });

    // tabB never reloaded — it must react to the storage event and drop
    // its session too, instead of silently refreshing back in on the next 401.
    await expect(tabB.getByTestId("login-page")).toBeVisible({ timeout: 10_000 });

    await tabA.close();
    await tabB.close();
  });
});

test.describe("Registration flow", () => {
  test("Register a new organizer account and land on onboarding", async ({ page }) => {
    const unique = Date.now();
    const email = `e2e-${unique}@ticketyourself.com`;
    const slug = `e2e-org-${unique}`;

    await page.goto("/register");
    await page.getByTestId("plan-card-profesional-cta").click();
    await expect(page.getByTestId("register-page")).toBeVisible();

    await page.getByTestId("register-email-input").fill(email);
    await page.getByTestId("register-phone-input").fill("0991234567");
    await page.getByTestId("register-password-input").fill("Password123!");
    await page.getByTestId("register-confirm-input").fill("Password123!");
    await page.getByTestId("register-company-input").fill(`E2E Org ${unique}`);
    await page.getByTestId("register-legal-input").fill("1790012345001");
    await page.getByTestId("register-slug-input").fill(slug);

    await expect(page.getByTestId("register-slug-feedback")).toContainText("disponible", {
      timeout: 10_000,
    });

    await page.getByTestId("register-submit-btn").click();

    await expect(page.getByTestId("onboarding-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("onboarding-docs-panel")).toBeVisible();

    const accessToken = await page.evaluate(() => localStorage.getItem("tys_access_token"));
    const refreshToken = await page.evaluate(() => localStorage.getItem("tys_refresh_token"));
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();
  });

  // Regression coverage for client feedback: "No me sirve el boton de Simular
  // Pago + Aprobacion. Me sale el mensaje que ya esta pero no avanza del pago."
  // Reproduces the full lifecycle — register, admin-approve, then use the
  // demo shortcut — instead of just unit-testing the button handler, since
  // the reported bug was about navigation not firing after the API call.
  test("Simular pago + aprobación advances an approved organizer to the dashboard", async ({ page }) => {
    const unique = Date.now();
    const email = `e2e-demo-${unique}@ticketyourself.com`;
    const slug = `e2e-demo-org-${unique}`;

    await page.goto("/register");
    await page.getByTestId("plan-card-profesional-cta").click();
    await page.getByTestId("register-email-input").fill(email);
    await page.getByTestId("register-phone-input").fill("0991234567");
    await page.getByTestId("register-password-input").fill("Password123!");
    await page.getByTestId("register-confirm-input").fill("Password123!");
    await page.getByTestId("register-company-input").fill(`E2E Demo Org ${unique}`);
    await page.getByTestId("register-legal-input").fill("1790012345001");
    await page.getByTestId("register-slug-input").fill(slug);
    await expect(page.getByTestId("register-slug-feedback")).toContainText("disponible", {
      timeout: 10_000,
    });
    await page.getByTestId("register-submit-btn").click();
    await expect(page.getByTestId("onboarding-page")).toBeVisible({ timeout: 15_000 });

    // Log out the new organizer and approve it as super admin — status
    // "approved" with subscription_status "none" is exactly the state that
    // renders the onboarding "plan" phase with the demo-activation shortcut.
    await page.getByTestId("org-desktop-header").getByTestId("org-user-menu").click();
    await page.getByTestId("user-menu-logout").click();
    await expect(page.getByTestId("login-page")).toBeVisible({ timeout: 10_000 });

    // Super-admin has its own login (/admin/login) — separate from /login.
    await page.goto("/admin/login");
    await page.getByTestId("admin-login-email-input").fill("admin@ticketyourself.com");
    await page.getByTestId("admin-login-password-input").fill("Admin123!");
    await page.getByTestId("admin-login-submit-btn").click();
    await expect(page.getByTestId("admin-organizers-page")).toBeVisible({ timeout: 15_000 }).catch(() => {});

    await page.goto("/admin/organizadores");
    await expect(page.getByTestId("admin-organizers-page")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("admin-orgs-search").fill(slug);
    const viewLink = page.getByTestId(`org-view-${slug}`);
    await expect(viewLink).toBeVisible({ timeout: 10_000 });
    const href = await viewLink.getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(href as string);
    await expect(page.getByTestId("admin-org-detail")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("admin-approve-btn").click();
    await expect(page.getByTestId("org-detail-status")).toContainText("approved", { timeout: 10_000 });

    await page.getByTestId("admin-desktop-header").getByTestId("admin-user-menu").click();
    await page.getByTestId("admin-logout").click();
    // Logging out from an admin-only route now bounces to /admin/login
    // (its own entry point), not the organizer /login.
    await expect(page.getByTestId("admin-login-page")).toBeVisible({ timeout: 10_000 });

    // Log back in as the newly-approved organizer.
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill(email);
    await page.getByTestId("login-password-input").fill("Password123!");
    await page.getByTestId("login-submit-btn").click();
    await expect(page.getByTestId("onboarding-plan-panel")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("demo-shortcut-btn")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("demo-shortcut-btn").click();

    // Before the fix, this showed a success toast but never left the plan
    // screen — the bug report's "no avanza del pago".
    await expect(page.getByTestId("dashboard-home")).toBeVisible({ timeout: 15_000 });
  });
});

// Regression coverage for client feedback: "Diferenciar entre el acceso de
// SuperAdmin y Organizers/Clientes" — super-admin now has its own login at
// /admin/login instead of sharing /login with organizers.
test.describe("Separate SuperAdmin and organizer login", () => {
  test("Super-admin credentials are rejected on the organizer /login form", async ({ page }) => {
    await page.goto("/login");
    await page.getByTestId("login-email-input").fill("admin@ticketyourself.com");
    await page.getByTestId("login-password-input").fill("Admin123!");
    await page.getByTestId("login-submit-btn").click();

    // The role check happens before any token/session is persisted, so a
    // rejected login never authenticates at all — the user simply stays on
    // /login with an error toast, instead of briefly logging in and then
    // being logged back out.
    await expect(page.getByTestId("login-page")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login$/);
    const accessToken = await page.evaluate(() => localStorage.getItem("tys_access_token"));
    expect(accessToken).toBeFalsy();
  });

  test("Organizer credentials are rejected on /admin/login", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByTestId("admin-login-page")).toBeVisible();
    await page.getByTestId("admin-login-email-input").fill("demo@ticketyourself.com");
    await page.getByTestId("admin-login-password-input").fill("Organizer123!");
    await page.getByTestId("admin-login-submit-btn").click();

    // Same as above: rejected before any session is persisted, so the user
    // stays on /admin/login rather than bouncing through a logged-in state.
    await expect(page.getByTestId("admin-login-page")).toBeVisible({ timeout: 10_000 });
    const accessToken = await page.evaluate(() => localStorage.getItem("tys_access_token"));
    expect(accessToken).toBeFalsy();
  });

  test("Visiting an admin-only route while logged out redirects to /admin/login", async ({ page }) => {
    await page.goto("/admin/organizadores");
    await expect(page.getByTestId("admin-login-page")).toBeVisible({ timeout: 10_000 });
  });

  test("Super-admin logs in successfully through /admin/login", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByTestId("admin-login-email-input").fill("admin@ticketyourself.com");
    await page.getByTestId("admin-login-password-input").fill("Admin123!");
    await page.getByTestId("admin-login-submit-btn").click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 10_000 });
  });

  // Regression coverage: AdminLogin used to ignore location.state.from and
  // always land on /admin, dropping a deep-linked admin destination.
  test("Logging in from a deep admin link returns to that page, not just /admin", async ({ page }) => {
    await page.goto("/admin/organizadores");
    await expect(page.getByTestId("admin-login-page")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("admin-login-email-input").fill("admin@ticketyourself.com");
    await page.getByTestId("admin-login-password-input").fill("Admin123!");
    await page.getByTestId("admin-login-submit-btn").click();

    await expect(page).toHaveURL(/\/admin\/organizadores$/, { timeout: 10_000 });
  });
});
