import { expect, test } from "@playwright/test";

test("home -> login and login form renders", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Go to Login" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("unauthenticated cannot open protected routes", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/board/TEST1234", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/$/);
});
