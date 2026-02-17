import { expect, test } from "@playwright/test";
import WebSocket from "ws";

function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * p));
  return sortedValues[index];
}

test("websocket latency stays within limits", async () => {
  const wsUrl = process.env.PERF_WS_URL;
  test.skip(!wsUrl, "PERF_WS_URL is not set");

  const sampleCount = Number(process.env.PERF_WS_SAMPLES ?? 25);
  const timeoutMs = Number(process.env.PERF_WS_TIMEOUT_MS ?? 1200);
  const maxAvgMs = Number(process.env.PERF_WS_MAX_AVG_MS ?? 120);
  const maxP95Ms = Number(process.env.PERF_WS_MAX_P95_MS ?? 250);

  const ws = new WebSocket(wsUrl!);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const latencies: number[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const latency = await new Promise<number>((resolve, reject) => {
      const payload = Buffer.from(`perf-${i}`);
      const started = Date.now();
      const timeout = setTimeout(() => {
        ws.off("pong", onPong);
        reject(new Error(`Ping timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const onPong = (data: Buffer) => {
        if (data.toString() !== payload.toString()) return;
        clearTimeout(timeout);
        ws.off("pong", onPong);
        resolve(Date.now() - started);
      };

      ws.on("pong", onPong);
      ws.ping(payload);
    });
    latencies.push(latency);
  }

  ws.close();
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  const p95 = percentile(sorted, 0.95);

  expect(avg).toBeLessThanOrEqual(maxAvgMs);
  expect(p95).toBeLessThanOrEqual(maxP95Ms);
});
