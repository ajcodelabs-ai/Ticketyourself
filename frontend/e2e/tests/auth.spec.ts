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
