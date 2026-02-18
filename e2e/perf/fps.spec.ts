import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";
import { envNumber, perfBoardId } from "./config";

test("board view FPS stays above thresholds", async ({ page, baseURL }) => {
  const minAverageFps = envNumber("PERF_MIN_AVG_FPS", 50);
  const minP10Fps = envNumber("PERF_MIN_P10_FPS", 30);
  const sampleDurationMs = envNumber("PERF_FPS_SAMPLE_MS", 5000);

  const signedIn = await signInIfCredentialsExist(page);
  const targetPath = signedIn ? `/board/${perfBoardId()}` : "/";
  await page.goto(new URL(targetPath, baseURL).toString(), { waitUntil: "networkidle" });
  if (signedIn) {
    await page.locator("canvas").first().waitFor();
  }

  const measurePromise = page.evaluate(async (durationMs) => {
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

  if (signedIn) {
    // Simulate active board manipulation while FPS is being sampled.
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      await page.getByRole("button", { name: "Hand (drag board)" }).click();
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + 180, centerY + 120, { steps: 12 });
      await page.mouse.move(centerX - 160, centerY - 90, { steps: 12 });
      await page.mouse.up();

      await page.mouse.move(centerX, centerY);
      await page.mouse.wheel(0, -1400);
      await page.mouse.wheel(0, 1400);
    }
  }

  const result = await measurePromise;
  expect(result.samples).toBeGreaterThan(100);
  expect(result.avg).toBeGreaterThanOrEqual(minAverageFps);
  expect(result.p10).toBeGreaterThanOrEqual(minP10Fps);
});
