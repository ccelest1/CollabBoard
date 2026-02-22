import { expect, test, type Page } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";

async function metric(page: Page, key: string) {
  return page.locator("[data-testid='board-metrics']").evaluate((node, datasetKey) => {
    const value = (node as HTMLElement).dataset[datasetKey as keyof DOMStringMap];
    return value ?? "";
  }, key);
}

test("board operations: inline text edit, selection handles, transforms, connectors, and clipboard", async ({
  page,
  baseURL,
}) => {
  const signedIn = await signInIfCredentialsExist(page);
  test.skip(!signedIn, "E2E login credentials are required");

  await page.goto(new URL(`/board/${process.env.PERF_BOARD_ID ?? "PERFTEST"}`, baseURL).toString(), {
    waitUntil: "networkidle",
  });
  await page.locator("canvas").first().waitFor();
  await page.evaluate(() => window.__bendPerf?.clearObjects());

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const originX = (box?.x ?? 0) + 220;
  const originY = (box?.y ?? 0) + 210;

  await page.getByRole("button", { name: "Rectangle" }).click();
  await page.mouse.click(originX, originY);

  await page.getByRole("button", { name: "Circle" }).click();
  await page.mouse.click(originX + 320, originY + 40);

  await page.getByRole("button", { name: "Text" }).click();
  await page.mouse.click(originX + 180, originY + 240);
  await page.getByRole("button", { name: "Cursor (select objects)" }).click();

  await page.mouse.dblclick(originX + 190, originY + 250);
  await expect(page.getByTestId("inline-text-editor")).toBeVisible();
  await page.getByTestId("inline-text-editor").fill("inline text edit");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => metric(page, "selectedText")).toContain("inline text edit");

  await page.mouse.click(originX + 10, originY + 10);
  await expect(page.getByTestId("selection-outline")).toBeVisible();
  await expect(page.getByTestId("resize-handle-nw")).toBeVisible();
  await expect(page.getByTestId("resize-handle-ne")).toBeVisible();
  await expect(page.getByTestId("resize-handle-sw")).toBeVisible();
  await expect(page.getByTestId("resize-handle-se")).toBeVisible();

  const widthBefore = Number(await metric(page, "selectedWidth"));
  await page.getByTestId("resize-handle-se").hover();
  await page.mouse.down();
  await page.mouse.move(originX + 110, originY + 120, { steps: 8 });
  await page.mouse.up();
  const widthAfterResize = Number(await metric(page, "selectedWidth"));
  expect(widthAfterResize).toBeGreaterThan(widthBefore);

  await page.getByRole("button", { name: "Line" }).click();
  await page.mouse.click(originX + 40, originY - 40);
  await page.mouse.click(originX + 340, originY + 120);
  const countAfterLine = Number(await metric(page, "objectCount"));
  expect(countAfterLine).toBeGreaterThanOrEqual(4);

  await page.mouse.move(originX - 50, originY - 60);
  await page.mouse.down();
  await page.mouse.move(originX + 500, originY + 380, { steps: 12 });
  await page.mouse.up();
  const selectedAfterMarquee = Number(await metric(page, "selectedCount"));
  expect(selectedAfterMarquee).toBeGreaterThanOrEqual(2);

  await page.mouse.click(originX + 10, originY + 10);
  const yBeforeShiftDrag = Number(await metric(page, "selectedY"));
  await page.mouse.move(originX + 10, originY + 10);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(originX + 140, originY + 78, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const yAfterShiftDrag = Number(await metric(page, "selectedY"));
  expect(Math.abs(yAfterShiftDrag - yBeforeShiftDrag)).toBeLessThanOrEqual(3);

  const countBeforeDuplicate = Number(await metric(page, "objectCount"));
  await page.getByRole("button", { name: "Duplicate" }).click();
  const countAfterDuplicate = Number(await metric(page, "objectCount"));
  expect(countAfterDuplicate).toBeGreaterThan(countBeforeDuplicate);

  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  const countAfterPaste = Number(await metric(page, "objectCount"));
  expect(countAfterPaste).toBeGreaterThan(countAfterDuplicate);

  await page.keyboard.press("ControlOrMeta+x");
  const countAfterCut = Number(await metric(page, "objectCount"));
  expect(countAfterCut).toBeLessThan(countAfterPaste);

  await page.keyboard.press("Delete");
  const countAfterDelete = Number(await metric(page, "objectCount"));
  expect(countAfterDelete).toBeLessThanOrEqual(countAfterCut);
});
