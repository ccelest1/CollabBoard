"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

type TestSummary = {
  fpsAvg: number;
  fpsMin: number;
  degraded: boolean;
  completedAt: number;
  details?: string;
};

type PerformanceMonitorProps = {
  visible: boolean;
  objectCount: number;
  activeUserCount: number;
  onRunObjectCapacityTest: (count: number) => Promise<void> | void;
  onRunConcurrentUserSimulation: (users: number) => Promise<void> | void;
};

export type PerformanceMonitorHandle = {
  recordObjectSyncLatency: (latencyMs: number) => void;
  recordCursorSyncLatency: (latencyMs: number) => void;
};

const FPS_TARGET = 60;
const OBJECT_SYNC_TARGET_MS = 100;
const CURSOR_SYNC_TARGET_MS = 50;
const MAX_LATENCY_SAMPLES = 200;
const LOW_FPS_WARN_COOLDOWN_MS = 2500;
const DEV_MODE = process.env.NODE_ENV !== "production";

function clampSamples(samples: number[], value: number) {
  const next = [...samples, value];
  if (next.length <= MAX_LATENCY_SAMPLES) return next;
  return next.slice(next.length - MAX_LATENCY_SAMPLES);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((max, value) => (value > max ? value : max), values[0]);
}

function metricClassHigherBetter(value: number, target: number) {
  if (value >= target) return "text-emerald-600";
  if (value >= target * 0.9) return "text-amber-500";
  return "text-red-600";
}

function metricClassLowerBetter(value: number, target: number) {
  if (value <= target) return "text-emerald-600";
  if (value <= target * 1.25) return "text-amber-500";
  return "text-red-600";
}

function formatMs(value: number) {
  return `${value.toFixed(1)}ms`;
}

export const PerformanceMonitor = forwardRef<PerformanceMonitorHandle, PerformanceMonitorProps>(function PerformanceMonitor(
  { visible, objectCount, activeUserCount, onRunObjectCapacityTest, onRunConcurrentUserSimulation },
  ref,
) {
  const [fps, setFps] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [objectLatencies, setObjectLatencies] = useState<number[]>([]);
  const [cursorLatencies, setCursorLatencies] = useState<number[]>([]);
  const [capacityTestSummary, setCapacityTestSummary] = useState<TestSummary | null>(null);
  const [concurrencyTestSummary, setConcurrencyTestSummary] = useState<TestSummary | null>(null);
  const [testRunning, setTestRunning] = useState<"none" | "capacity" | "concurrency">("none");

  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  const fpsWindowRef = useRef<number[]>([]);
  const fpsTimelineRef = useRef<Array<{ at: number; fps: number }>>([]);
  const lastWarnRef = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      recordObjectSyncLatency(latencyMs: number) {
        setObjectLatencies((current) => clampSamples(current, latencyMs));
      },
      recordCursorSyncLatency(latencyMs: number) {
        setCursorLatencies((current) => clampSamples(current, latencyMs));
      },
    }),
    [],
  );

  useEffect(() => {
    if (!DEV_MODE) return;

    const tick = (timestamp: number) => {
      if (lastFrameTimeRef.current > 0) {
        const delta = timestamp - lastFrameTimeRef.current;
        if (delta > 0) {
          const instantFps = 1000 / delta;
          const nextWindow = [...fpsWindowRef.current, instantFps];
          fpsWindowRef.current = nextWindow.slice(-40);
          const smoothed = average(fpsWindowRef.current);
          setFps(smoothed);

          const now = performance.now();
          const nextTimeline = [...fpsTimelineRef.current, { at: now, fps: smoothed }];
          fpsTimelineRef.current = nextTimeline.filter((item) => now - item.at <= 30_000);

          if (smoothed < FPS_TARGET && now - lastWarnRef.current > LOW_FPS_WARN_COOLDOWN_MS) {
            lastWarnRef.current = now;
            console.warn(`[PerformanceMonitor] FPS dropped below target: ${smoothed.toFixed(1)} < ${FPS_TARGET}`);
          }
        }
      }
      lastFrameTimeRef.current = timestamp;
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const objectLatencyAvg = useMemo(() => average(objectLatencies), [objectLatencies]);
  const objectLatencyMax = useMemo(() => maximum(objectLatencies), [objectLatencies]);
  const cursorLatencyAvg = useMemo(() => average(cursorLatencies), [cursorLatencies]);
  const cursorLatencyMax = useMemo(() => maximum(cursorLatencies), [cursorLatencies]);

  const runTimedTest = async (
    type: "capacity" | "concurrency",
    runner: () => Promise<void> | void,
    details: string,
  ) => {
    const startedAt = performance.now();
    setTestRunning(type);
    try {
      await runner();
      const endedAt = performance.now();
      const samples = fpsTimelineRef.current
        .filter((entry) => entry.at >= startedAt && entry.at <= endedAt)
        .map((entry) => entry.fps);
      const avg = average(samples);
      const min = samples.length > 0 ? Math.min(...samples) : fps;
      const summary: TestSummary = {
        fpsAvg: avg,
        fpsMin: min,
        degraded: avg < FPS_TARGET || min < FPS_TARGET * 0.85,
        completedAt: Date.now(),
        details,
      };
      if (type === "capacity") {
        setCapacityTestSummary(summary);
      } else {
        setConcurrencyTestSummary(summary);
      }
    } finally {
      setTestRunning("none");
    }
  };

  if (!DEV_MODE) return null;

  return (
    <>
      <div className="pointer-events-none absolute left-2 top-2 z-40 rounded-md border border-slate-300 bg-white/95 px-2 py-1 text-xs shadow-sm">
        <span className={`font-semibold ${metricClassHigherBetter(fps, FPS_TARGET)}`}>FPS {fps.toFixed(1)}</span>
      </div>

      {visible ? (
        <div className="absolute left-4 top-16 z-40 w-80 rounded-xl border border-slate-300 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Performance Monitor</p>
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          </div>

          {expanded ? (
            <div className="space-y-2 text-xs text-slate-700">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-slate-200 p-2">
                  <p className="text-slate-500">Current FPS</p>
                  <p className={`text-sm font-semibold ${metricClassHigherBetter(fps, FPS_TARGET)}`}>{fps.toFixed(1)}</p>
                </div>
                <div className="rounded border border-slate-200 p-2">
                  <p className="text-slate-500">Objects / Users</p>
                  <p className="text-sm font-semibold text-slate-800">
                    {objectCount} / {activeUserCount}
                  </p>
                </div>
              </div>

              <div className="rounded border border-slate-200 p-2">
                <p className="font-medium text-slate-800">Sync Latency</p>
                <p className={`mt-1 ${metricClassLowerBetter(objectLatencyAvg, OBJECT_SYNC_TARGET_MS)}`}>
                  Object avg/max: {formatMs(objectLatencyAvg)} / {formatMs(objectLatencyMax)}
                </p>
                <p className={metricClassLowerBetter(cursorLatencyAvg, CURSOR_SYNC_TARGET_MS)}>
                  Cursor avg/max: {formatMs(cursorLatencyAvg)} / {formatMs(cursorLatencyMax)}
                </p>
              </div>

              <div className="rounded border border-slate-200 p-2">
                <p className="mb-2 font-medium text-slate-800">Test Controls</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={testRunning !== "none"}
                    onClick={() =>
                      void runTimedTest(
                        "capacity",
                        () => onRunObjectCapacityTest(500),
                        "Spawned 500 random objects",
                      )
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                  >
                    Run 500 Objects
                  </button>
                  <button
                    type="button"
                    disabled={testRunning !== "none"}
                    onClick={() =>
                      void runTimedTest(
                        "concurrency",
                        () => onRunConcurrentUserSimulation(5),
                        "Simulated 5 concurrent cursors",
                      )
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                  >
                    Simulate 5 Users
                  </button>
                </div>
                {testRunning !== "none" ? (
                  <p className="mt-2 text-amber-600">Running {testRunning} test...</p>
                ) : null}
              </div>

              <div className="rounded border border-slate-200 p-2">
                <p className="font-medium text-slate-800">Latest Results</p>
                <p className="mt-1 text-slate-600">
                  Capacity:{" "}
                  {capacityTestSummary ? (
                    <span className={capacityTestSummary.degraded ? "text-red-600" : "text-emerald-600"}>
                      avg {capacityTestSummary.fpsAvg.toFixed(1)} / min {capacityTestSummary.fpsMin.toFixed(1)} fps
                    </span>
                  ) : (
                    "Not run"
                  )}
                </p>
                <p className="text-slate-600">
                  Concurrent:{" "}
                  {concurrencyTestSummary ? (
                    <span className={concurrencyTestSummary.degraded ? "text-red-600" : "text-emerald-600"}>
                      avg {concurrencyTestSummary.fpsAvg.toFixed(1)} / min {concurrencyTestSummary.fpsMin.toFixed(1)} fps
                    </span>
                  ) : (
                    "Not run"
                  )}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
});

