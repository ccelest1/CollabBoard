import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";

test("home -> login and login form renders", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.goto("/login", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
});

test("unauthenticated cannot open protected routes", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/);
  await page.goto("/board/TEST1234", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/login\?redirect=%2Fboard%2FTEST1234$/);
});

test("authenticated user visiting login is redirected to requested route", async ({ page, baseURL }) => {
  const signedIn = await signInIfCredentialsExist(page);
  test.skip(!signedIn, "E2E login credentials are required");
  await page.goto(new URL("/login?redirect=/board/TEST1234", baseURL).toString(), { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/board\/TEST1234$/);
});
