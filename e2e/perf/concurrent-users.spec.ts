import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";
import { envNumber, perfBoardId } from "./config";

test("5+ concurrent users keep cursor sync healthy", async ({ browser, baseURL }) => {
  const userCount = envNumber("PERF_CONCURRENT_USERS", 5);
  const maxCursorP95Ms = envNumber("PERF_CONCURRENT_CURSOR_MAX_P95_MS", 90);
  const sampleWaitMs = envNumber("PERF_CONCURRENT_SAMPLE_WAIT_MS", 10_000);

  const contexts = await Promise.all(Array.from({ length: userCount }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));

  try {
    const signIns = await Promise.all(pages.map((page) => signInIfCredentialsExist(page)));
    test.skip(signIns.some((value) => !value), "E2E login credentials are required");

    const boardUrl = new URL(`/board/${perfBoardId()}`, baseURL).toString();
    await Promise.all(pages.map((page) => page.goto(boardUrl, { waitUntil: "networkidle" })));
    await Promise.all(pages.map((page) => page.locator("canvas").first().waitFor()));

    const leader = pages[0];
    const leaderCanvas = leader.locator("canvas").first();
    const box = await leaderCanvas.boundingBox();
    expect(box).not.toBeNull();
    const centerX = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const centerY = (box?.y ?? 0) + (box?.height ?? 0) / 2;

    for (let i = 0; i < 14; i += 1) {
      const direction = i % 2 === 0 ? 1 : -1;
      await leader.mouse.move(centerX + direction * 180, centerY + direction * 100, { steps: 8 });
      await leader.waitForTimeout(20);
    }

    const samplePromises = pages.slice(1).map((page) =>
      page.evaluate(async (timeoutMs) => {
        const metricsNode = document.querySelector("[data-testid='board-metrics']") as HTMLElement | null;
        if (!metricsNode) return { latencies: [], collaborators: 0 };

        const latencies: number[] = [];
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const latency = Number(metricsNode.dataset.lastRemoteCursorLatency ?? "-1");
          const collaborators = Number(metricsNode.dataset.collaboratorCount ?? "0");
          if (latency >= 0) latencies.push(latency);
          if (collaborators >= 5 && latencies.length >= 6) {
            return { latencies, collaborators };
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return {
          latencies,
          collaborators: Number(metricsNode.dataset.collaboratorCount ?? "0"),
        };
      }, sampleWaitMs),
    );

    const samples = await Promise.all(samplePromises);
    for (const sample of samples) {
      expect(sample.collaborators).toBeGreaterThanOrEqual(5);
      expect(sample.latencies.length).toBeGreaterThanOrEqual(4);
      const sorted = [...sample.latencies].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
      expect(p95).toBeLessThanOrEqual(maxCursorP95Ms);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
