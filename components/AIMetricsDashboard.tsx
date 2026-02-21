"use client";

import { useEffect, useState } from "react";

type Metrics = {
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  commandBreakdown: {
    creation: number;
    manipulation: number;
    layout: number;
    complex: number;
  };
  slowCommands: Array<{ command: string; durationMs: number }>;
};

const EMPTY_METRICS: Metrics = {
  avgLatencyMs: 0,
  p95LatencyMs: 0,
  errorRate: 0,
  commandBreakdown: {
    creation: 0,
    manipulation: 0,
    layout: 0,
    complex: 0,
  },
  slowCommands: [],
};

function StatusBadge({ pass }: { pass: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        pass ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      {pass ? "PASS" : "FAIL"}
    </span>
  );
}

export function AIMetricsDashboard() {
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/metrics");
      const payload = (await response.json()) as Metrics;
      if (!response.ok) {
        throw new Error("Failed to fetch metrics");
      }
      setMetrics(payload);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to fetch metrics";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadMetrics();
  }, []);

  return (
    <div className="space-y-4 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">AI Metrics Dashboard</h1>
        <button
          type="button"
          onClick={() => void loadMetrics()}
          disabled={isLoading}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Metric</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Value</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b border-slate-100 px-3 py-2">Average latency</td>
              <td className="border-b border-slate-100 px-3 py-2">{Math.round(metrics.avgLatencyMs)} ms</td>
              <td className="border-b border-slate-100 px-3 py-2">
                <StatusBadge pass={metrics.avgLatencyMs < 2000} />
              </td>
            </tr>
            <tr>
              <td className="border-b border-slate-100 px-3 py-2">P95 latency</td>
              <td className="border-b border-slate-100 px-3 py-2">{Math.round(metrics.p95LatencyMs)} ms</td>
              <td className="border-b border-slate-100 px-3 py-2">
                <StatusBadge pass={metrics.p95LatencyMs < 4000} />
              </td>
            </tr>
            <tr>
              <td className="border-b border-slate-100 px-3 py-2">Error rate</td>
              <td className="border-b border-slate-100 px-3 py-2">{(metrics.errorRate * 100).toFixed(2)}%</td>
              <td className="border-b border-slate-100 px-3 py-2">
                <StatusBadge pass={metrics.errorRate < 0.05} />
              </td>
            </tr>
            <tr>
              <td className="border-b border-slate-100 px-3 py-2">Command breakdown</td>
              <td className="border-b border-slate-100 px-3 py-2" colSpan={2}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700">
                  <span>creation: {metrics.commandBreakdown.creation}</span>
                  <span>manipulation: {metrics.commandBreakdown.manipulation}</span>
                  <span>layout: {metrics.commandBreakdown.layout}</span>
                  <span>complex: {metrics.commandBreakdown.complex}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">
          Slow commands ({metrics.slowCommands.length})
        </summary>
        <div className="mt-2 space-y-2">
          {metrics.slowCommands.length === 0 ? (
            <p className="text-xs text-slate-500">No slow commands in selected window.</p>
          ) : (
            metrics.slowCommands.map((item, index) => (
              <div key={`${item.command}-${index}`} className="rounded-md bg-slate-50 p-2 text-xs">
                <p className="font-medium text-slate-800">{item.command}</p>
                <p className="text-slate-500">{Math.round(item.durationMs)} ms</p>
              </div>
            ))
          )}
        </div>
      </details>
    </div>
  );
}
