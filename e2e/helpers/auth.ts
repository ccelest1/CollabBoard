import { expect, type Page } from "@playwright/test";

export async function signInIfCredentialsExist(page: Page) {
  const email = process.env.E2E_LOGIN_EMAIL;
  const password = process.env.E2E_LOGIN_PASSWORD;
  if (!email || !password) return false;

  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return true;
}
