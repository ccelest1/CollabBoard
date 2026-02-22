import { expect, test, type Page } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";

async function metric(page: Page, key: string) {
  return page.locator("[data-testid='board-metrics']").evaluate((node, datasetKey) => {
    const value = (node as HTMLElement).dataset[datasetKey as keyof DOMStringMap];
    return value ?? "";
  }, key);
}

test("cmd/ctrl+a then delete removes all board objects and syncs to collaborators", async ({ browser, baseURL }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const signedInA = await signInIfCredentialsExist(pageA);
    const signedInB = await signInIfCredentialsExist(pageB);
    test.skip(!signedInA || !signedInB, "E2E login credentials are required");

    const boardUrl = new URL(`/board/${process.env.PERF_BOARD_ID ?? "PERFTEST"}`, baseURL).toString();
    await pageA.goto(boardUrl, { waitUntil: "networkidle" });
    await pageB.goto(boardUrl, { waitUntil: "networkidle" });
    await pageA.locator("canvas").first().waitFor();
    await pageB.locator("canvas").first().waitFor();

    await pageA.evaluate(() => window.__bendPerf?.clearObjects());
    await expect.poll(async () => Number(await metric(pageA, "objectCount"))).toBe(0);
    await expect.poll(async () => Number(await metric(pageB, "objectCount"))).toBe(0);

    await pageA.evaluate(() => window.__bendPerf?.seedObjects(12));
    await expect.poll(async () => Number(await metric(pageA, "objectCount"))).toBeGreaterThanOrEqual(12);
    await expect.poll(async () => Number(await metric(pageB, "objectCount"))).toBeGreaterThanOrEqual(12);

    await pageA.keyboard.press("ControlOrMeta+a");
    await expect.poll(async () => Number(await metric(pageA, "selectedCount"))).toBeGreaterThanOrEqual(12);
    await pageA.keyboard.press("Delete");

    await expect.poll(async () => Number(await metric(pageA, "objectCount"))).toBe(0);
    await expect.poll(async () => Number(await metric(pageA, "selectedCount"))).toBe(0);
    await expect.poll(async () => Number(await metric(pageB, "objectCount"))).toBe(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

