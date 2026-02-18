import { expect, test } from "@playwright/test";
import { signInIfCredentialsExist } from "../helpers/auth";
import { envNumber, perfBoardId } from "./config";
import { average, percentile } from "./stats";

type ObjectSyncResult = {
  samples: number[];
  finalCount: number;
};

test("multiplayer object sync stays under latency target", async ({ browser, baseURL }) => {
  const maxAvgMs = envNumber("PERF_OBJECT_MAX_AVG_MS", 100);
  const maxP95Ms = envNumber("PERF_OBJECT_MAX_P95_MS", 180);
  const minSamples = envNumber("PERF_OBJECT_MIN_SAMPLES", 6);
  const waitTimeoutMs = envNumber("PERF_OBJECT_TIMEOUT_MS", 14_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const signedInA = await signInIfCredentialsExist(pageA);
    const signedInB = await signInIfCredentialsExist(pageB);
    test.skip(!signedInA || !signedInB, "E2E login credentials are required");

    const boardUrl = new URL(`/board/${perfBoardId()}`, baseURL).toString();
    await pageA.goto(boardUrl, { waitUntil: "networkidle" });
    await pageB.goto(boardUrl, { waitUntil: "networkidle" });
    await pageA.locator("canvas").first().waitFor();
    await pageB.locator("canvas").first().waitFor();

    const initialCount = await pageB.locator("[data-testid='board-metrics']").evaluate((node) =>
      Number((node as HTMLElement).dataset.objectCount ?? "0"),
    );

    const collectPromise = pageB.evaluate(
      async ({ minCountDelta, timeoutMs }): Promise<ObjectSyncResult> => {
        const node = document.querySelector("[data-testid='board-metrics']") as HTMLElement | null;
        if (!node) return { samples: [], finalCount: 0 };

        const samples: number[] = [];
        const start = Date.now();
        const initial = Number(node.dataset.objectCount ?? "0");
        let finalCount = initial;

        while (Date.now() - start < timeoutMs) {
          finalCount = Number(node.dataset.objectCount ?? "0");
          const latency = Number(node.dataset.lastRemoteObjectLatency ?? "-1");
          if (Number.isFinite(latency) && latency >= 0) {
            samples.push(latency);
          }
          if (finalCount - initial >= minCountDelta && samples.length >= minCountDelta) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 30));
        }

        return { samples, finalCount };
      },
      { minCountDelta: minSamples, timeoutMs: waitTimeoutMs },
    );

    await pageA.getByRole("button", { name: "Sticky note" }).click();
    const canvas = pageA.locator("canvas").first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    const left = (box?.x ?? 0) + 100;
    const top = (box?.y ?? 0) + 100;
    for (let i = 0; i < minSamples; i += 1) {
      await pageA.mouse.click(left + i * 28, top + i * 24);
      await pageA.waitForTimeout(25);
    }

    const result = await collectPromise;
    expect(result.finalCount).toBeGreaterThanOrEqual(initialCount + minSamples);
    expect(result.samples.length).toBeGreaterThanOrEqual(minSamples);

    const sorted = [...result.samples].sort((a, b) => a - b);
    expect(average(result.samples)).toBeLessThanOrEqual(maxAvgMs);
    expect(percentile(sorted, 0.95)).toBeLessThanOrEqual(maxP95Ms);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
