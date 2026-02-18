import { expect, test, type Page } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";

async function metric(page: Page, key: string) {
  return page.locator("[data-testid='board-metrics']").evaluate((node, datasetKey) => {
    const value = (node as HTMLElement).dataset[datasetKey as keyof DOMStringMap];
    return value ?? "";
  }, key);
}

test("multiplayer state stays consistent across create/delete and refresh", async ({ browser, baseURL }) => {
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

    // Start from a known clean board.
    await pageA.evaluate(() => window.__collabboardPerf?.clearObjects());
    await expect.poll(async () => Number(await metric(pageA, "objectCount"))).toBe(0);
    await expect.poll(async () => Number(await metric(pageB, "objectCount"))).toBe(0);

    const canvas = pageA.locator("canvas").first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const x = (box?.x ?? 0) + 220;
    const y = (box?.y ?? 0) + 220;

    // Create 2 sticky notes via normal UI flow.
    await pageA.getByRole("button", { name: "Sticky note" }).click();
    await pageA.mouse.click(x, y);
    await pageA.getByRole("button", { name: "Sticky note" }).click();
    await pageA.mouse.click(x + 160, y + 80);

    await expect.poll(async () => Number(await metric(pageA, "objectCount"))).toBe(2);
    await expect.poll(async () => Number(await metric(pageB, "objectCount"))).toBe(2);

    // Delete one object and verify both clients converge.
    await pageA.mouse.click(x + 10, y + 10);
    await pageA.keyboard.press("Delete");

    await expect.poll(async () => Number(await metric(pageA, "objectCount"))).toBe(1);
    await expect.poll(async () => Number(await metric(pageB, "objectCount"))).toBe(1);

    // Refresh Browser B and ensure persisted state still matches.
    await pageB.reload({ waitUntil: "networkidle" });
    await pageB.locator("canvas").first().waitFor();
    await expect.poll(async () => Number(await metric(pageB, "objectCount"))).toBe(1);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

