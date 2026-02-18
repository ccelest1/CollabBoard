import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";

test("board id copy button copies only id string", async ({ page, baseURL, context }) => {
  const signedIn = await signInIfCredentialsExist(page);
  test.skip(!signedIn, "E2E login credentials are required");

  const boardId = process.env.PERF_BOARD_ID ?? "PERFTEST";
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(new URL(`/board/${boardId}`, baseURL).toString(), { waitUntil: "networkidle" });
  await page.locator("canvas").first().waitFor();

  await page.getByRole("button", { name: "Copy" }).click();
  const copied = await page.evaluate(async () => navigator.clipboard.readText());
  expect(copied).toBe(boardId);
});
