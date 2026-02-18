import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";
import { envNumber, perfBoardId } from "./config";
import { average, percentile } from "./stats";

type CursorLatencyResult = { samples: number[]; timedOut: boolean };

test("multiplayer cursor sync stays within latency limits", async ({ browser, baseURL }) => {
  const boardId = perfBoardId();
  const maxAverageMs = envNumber("PERF_CURSOR_MAX_AVG_MS", 50);
  const maxP95Ms = envNumber("PERF_CURSOR_MAX_P95_MS", 80);
  const minSamples = envNumber("PERF_CURSOR_MIN_SAMPLES", 8);
  const waitForSamplesTimeoutMs = envNumber("PERF_CURSOR_TIMEOUT_MS", 12_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const signedInA = await signInIfCredentialsExist(pageA);
    const signedInB = await signInIfCredentialsExist(pageB);
    test.skip(!signedInA || !signedInB, "E2E_LOGIN_EMAIL and E2E_LOGIN_PASSWORD are required");

    const boardUrl = new URL(`/board/${boardId}`, baseURL).toString();
    await pageA.goto(boardUrl, { waitUntil: "networkidle" });
    await pageB.goto(boardUrl, { waitUntil: "networkidle" });

    await pageA.locator("canvas").first().waitFor();
    await pageB.locator("canvas").first().waitFor();

    const collectorPromise = pageB.evaluate(
      async ({ sampleTarget, timeoutMs }): Promise<CursorLatencyResult> => {
        const selector = '[data-testid^="remote-cursor-"]';
        const latencies: number[] = [];
        const seen = new Set<number>();

        const readCursorLatency = () => {
          const node = document.querySelector(selector);
          if (!node) return;
          const sentAt = Number((node as HTMLElement).dataset.sentAt ?? "0");
          if (!Number.isFinite(sentAt) || sentAt <= 0 || seen.has(sentAt)) return;
          seen.add(sentAt);
          latencies.push(Date.now() - sentAt);
        };

        const started = Date.now();
        while (Date.now() - started < timeoutMs && latencies.length < sampleTarget) {
          readCursorLatency();
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        return {
          samples: latencies,
          timedOut: latencies.length < sampleTarget,
        };
      },
      { sampleTarget: minSamples, timeoutMs: waitForSamplesTimeoutMs },
    );

    const canvasA = pageA.locator("canvas").first();
    const box = await canvasA.boundingBox();
    expect(box).not.toBeNull();

    const centerX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const centerY = (box?.y ?? 0) + (box?.height ?? 0) / 2;

    for (let i = 0; i < minSamples + 8; i += 1) {
      const direction = i % 2 === 0 ? 1 : -1;
      await pageA.mouse.move(centerX + direction * 120, centerY + direction * 60, { steps: 8 });
      await pageA.waitForTimeout(25);
    }

    const result = await collectorPromise;
    expect(result.timedOut).toBe(false);
    expect(result.samples.length).toBeGreaterThanOrEqual(minSamples);

    const sorted = [...result.samples].sort((a, b) => a - b);
    const avg = average(result.samples);
    const p95 = percentile(sorted, 0.95);

    expect(avg).toBeLessThanOrEqual(maxAverageMs);
    expect(p95).toBeLessThanOrEqual(maxP95Ms);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
