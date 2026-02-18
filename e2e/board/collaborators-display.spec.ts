import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";

test("collaborator avatars include self and cap at 3 with overflow", async ({ page, baseURL }) => {
  const signedIn = await signInIfCredentialsExist(page);
  test.skip(!signedIn, "E2E login credentials are required");

  await page.goto(new URL(`/board/${process.env.PERF_BOARD_ID ?? "PERFTEST"}`, baseURL).toString(), {
    waitUntil: "networkidle",
  });
  await page.locator("canvas").first().waitFor();

  // Scenario 1: only current user.
  await page.evaluate(() => {
    window.__collabboardPerf?.clearMockCollaborators();
  });
  await expect(page.getByTestId("collaborator-online-count")).toContainText("1 online");
  await expect(page.getByTestId("collaborator-avatars").locator("[data-testid^='collaborator-avatar-']")).toHaveCount(1);

  // Scenario 2: current user + 1 other.
  await page.evaluate(() => {
    window.__collabboardPerf?.setMockCollaborators(1);
  });
  await expect(page.getByTestId("collaborator-online-count")).toContainText("2 online");
  await expect(page.getByTestId("collaborator-avatars").locator("[data-testid^='collaborator-avatar-']")).toHaveCount(2);
  await expect(page.locator("[data-testid='collaborator-overflow']")).toHaveCount(0);

  // Scenario 3: current user + 2 others.
  await page.evaluate(() => {
    window.__collabboardPerf?.setMockCollaborators(2);
  });
  await expect(page.getByTestId("collaborator-online-count")).toContainText("3 online");
  await expect(page.getByTestId("collaborator-avatars").locator("[data-testid^='collaborator-avatar-']")).toHaveCount(3);
  await expect(page.locator("[data-testid='collaborator-overflow']")).toHaveCount(0);

  // Scenario 4: current user + 4 others.
  await page.evaluate(() => {
    window.__collabboardPerf?.setMockCollaborators(4);
  });
  await expect(page.getByTestId("collaborator-online-count")).toContainText("5 online");
  await expect(page.getByTestId("collaborator-avatars").locator("[data-testid^='collaborator-avatar-']")).toHaveCount(3);
  await expect(page.getByTestId("collaborator-overflow")).toHaveText("+2");

  const colors = await page
    .getByTestId("collaborator-avatars")
    .locator("[data-testid^='collaborator-avatar-']")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = window.getComputedStyle(node);
        return style.backgroundColor;
      }),
    );
  expect(new Set(colors).size).toBeGreaterThanOrEqual(2);

  await page.evaluate(() => {
    window.__collabboardPerf?.clearMockCollaborators();
  });
});

