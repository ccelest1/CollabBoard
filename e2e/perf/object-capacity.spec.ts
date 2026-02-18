import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";
import { envNumber, perfBoardId } from "./config";

test("board handles 500+ objects without severe FPS degradation", async ({ page, baseURL }) => {
  const requiredObjectCount = envNumber("PERF_OBJECT_CAPACITY_COUNT", 520);
  const minAverageFps = envNumber("PERF_CAPACITY_MIN_AVG_FPS", 40);
  const minP10Fps = envNumber("PERF_CAPACITY_MIN_P10_FPS", 22);
  const sampleDurationMs = envNumber("PERF_CAPACITY_SAMPLE_MS", 4500);

  const signedIn = await signInIfCredentialsExist(page);
  test.skip(!signedIn, "E2E login credentials are required");

  const boardUrl = new URL(`/board/${perfBoardId()}`, baseURL).toString();
  await page.goto(boardUrl, { waitUntil: "networkidle" });
  await page.locator("canvas").first().waitFor();

  const seededCount = await page.evaluate((count) => {
    window.__collabboardPerf?.clearObjects();
    return window.__collabboardPerf?.seedObjects(count) ?? 0;
  }, requiredObjectCount);
  expect(seededCount).toBeGreaterThanOrEqual(requiredObjectCount);

  const metricsCount = await page.locator("[data-testid='board-metrics']").evaluate((node) =>
    Number((node as HTMLElement).dataset.objectCount ?? "0"),
  );
  expect(metricsCount).toBeGreaterThanOrEqual(requiredObjectCount);

  const fpsPromise = page.evaluate(async (durationMs) => {
    const frames: number[] = [];
    let previous = performance.now();
    const started = previous;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        frames.push(now - previous);
        previous = now;
        if (now - started >= durationMs) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const fps = frames
      .filter((ms) => ms > 0)
      .map((ms) => 1000 / ms)
      .sort((a, b) => a - b);
    const avg = fps.reduce((sum, value) => sum + value, 0) / Math.max(fps.length, 1);
    const p10 = fps[Math.floor(fps.length * 0.1)] ?? 0;
    return { avg, p10, samples: fps.length };
  }, sampleDurationMs);

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const centerX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  const centerY = (box?.y ?? 0) + (box?.height ?? 0) / 2;

  await page.getByRole("button", { name: "Hand (drag board)" }).click();
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 260, centerY + 180, { steps: 15 });
  await page.mouse.move(centerX - 220, centerY - 140, { steps: 15 });
  await page.mouse.up();
  await page.mouse.wheel(0, -1500);
  await page.mouse.wheel(0, 1500);

  const fpsResult = await fpsPromise;
  expect(fpsResult.samples).toBeGreaterThan(100);
  expect(fpsResult.avg).toBeGreaterThanOrEqual(minAverageFps);
  expect(fpsResult.p10).toBeGreaterThanOrEqual(minP10Fps);
});
