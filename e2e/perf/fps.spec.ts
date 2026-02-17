import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";

test("board view FPS stays above thresholds", async ({ page, baseURL }) => {
  const minAverageFps = Number(process.env.PERF_MIN_AVG_FPS ?? 50);
  const minP10Fps = Number(process.env.PERF_MIN_P10_FPS ?? 30);
  const sampleDurationMs = Number(process.env.PERF_FPS_SAMPLE_MS ?? 5000);

  const signedIn = await signInIfCredentialsExist(page);
  const targetPath = signedIn ? `/board/${process.env.PERF_BOARD_ID ?? "PERFTEST"}` : "/";
  await page.goto(new URL(targetPath, baseURL).toString(), { waitUntil: "networkidle" });

  const result = await page.evaluate(async (durationMs) => {
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

  expect(result.samples).toBeGreaterThan(100);
  expect(result.avg).toBeGreaterThanOrEqual(minAverageFps);
  expect(result.p10).toBeGreaterThanOrEqual(minP10Fps);
});
