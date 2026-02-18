import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";

test("existing board can be joined from another session", async ({ browser, baseURL }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const signedInA = await signInIfCredentialsExist(pageA);
    const signedInB = await signInIfCredentialsExist(pageB);
    test.skip(!signedInA || !signedInB, "E2E login credentials are required");

    await pageA.goto(new URL("/dashboard", baseURL).toString(), { waitUntil: "networkidle" });
    const uniqueName = `e2e-${Date.now()}`;
    await pageA.getByPlaceholder("Board name (optional)").fill(uniqueName);
    await pageA.getByRole("button", { name: "Create New Board" }).click();
    await expect(pageA).toHaveURL(/\/board\/[A-Z0-9_-]+$/);

    const boardUrl = pageA.url();
    const boardId = boardUrl.split("/board/")[1] ?? "";
    expect(boardId.length).toBeGreaterThan(0);

    await pageB.goto(new URL("/dashboard", baseURL).toString(), { waitUntil: "networkidle" });
    await pageB.getByPlaceholder("Paste Board ID").fill(boardId);
    await pageB.getByRole("button", { name: "Join Board" }).click();
    await expect(pageB).toHaveURL(new RegExp(`/board/${boardId}$`));
    await expect(pageB.getByText(uniqueName).first()).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("authenticated user can open board by ID route", async ({ page, baseURL }) => {
  const signedIn = await signInIfCredentialsExist(page);
  test.skip(!signedIn, "E2E login credentials are required");

  await page.goto(new URL("/board/DOESNOTEXIST", baseURL).toString(), { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/board\/DOESNOTEXIST$/);
  await page.locator("canvas").first().waitFor();
});
