import { NextResponse } from "next/server";

type CommandType = "creation" | "manipulation" | "layout" | "complex";

type MetricsResponse = {
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  commandBreakdown: Record<CommandType, number>;
  slowCommands: Array<{ command: string; durationMs: number }>;
};

const DEFAULT_HOURS = 24;
const MAX_LIMIT = 500;
const COMMAND_TYPES: CommandType[] = ["creation", "manipulation", "layout", "complex"];

function emptyMetrics(): MetricsResponse {
  return {
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
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationMsFromRun(run: Record<string, unknown>) {
  const latency = safeNumber(run.latency ?? run.total_time);
  if (latency > 0) return latency;
  const startRaw = run.start_time;
  const endRaw = run.end_time;
  if (typeof startRaw === "string" && typeof endRaw === "string") {
    const start = new Date(startRaw).getTime();
    const end = new Date(endRaw).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return end - start;
    }
  }
  return 0;
}

function commandTypeFromRun(run: Record<string, unknown>): CommandType | null {
  const metadataType = (run.extra as { metadata?: { commandType?: unknown } } | undefined)?.metadata?.commandType;
  if (typeof metadataType === "string" && COMMAND_TYPES.includes(metadataType as CommandType)) {
    return metadataType as CommandType;
  }

  const tags = Array.isArray(run.tags) ? run.tags.map((tag) => String(tag)) : [];
  for (const type of COMMAND_TYPES) {
    if (tags.includes(type)) return type;
  }
  return null;
}

function commandTextFromRun(run: Record<string, unknown>) {
  const inputs = run.inputs;
  if (inputs && typeof inputs === "object") {
    const maybeMessages = (inputs as { messages?: unknown }).messages;
    if (Array.isArray(maybeMessages)) {
      const userMsg = maybeMessages.find(
        (message) => message && typeof message === "object" && (message as { role?: unknown }).role === "user",
      ) as { content?: unknown } | undefined;
      if (typeof userMsg?.content === "string" && userMsg.content.trim()) {
        return userMsg.content.trim();
      }
    }

    const inputField = (inputs as { input?: unknown }).input;
    if (typeof inputField === "string" && inputField.trim()) {
      return inputField.trim();
    }
  }
  return "(unknown command)";
}

async function fetchRuns(params: { apiKey: string; projectName: string; limit: number; startTimeIso: string }) {
  const headers = {
    Authorization: `Bearer ${params.apiKey}`,
  };
  const query = new URLSearchParams({
    project_name: params.projectName,
    limit: String(params.limit),
    start_time: params.startTimeIso,
  });

  const getResponse = await fetch(`https://api.smith.langchain.com/runs?${query.toString()}`, { headers });
  if (getResponse.ok) {
    const payload = (await getResponse.json()) as { runs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    return Array.isArray(payload) ? payload : (payload.runs ?? []);
  }

  // Fallback for environments where GET /runs is restricted.
  const postResponse = await fetch("https://api.smith.langchain.com/runs/query", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project_name: params.projectName,
      limit: Math.min(params.limit, 100),
      start_time: params.startTimeIso,
    }),
  });

  if (!postResponse.ok) return [];
  const payload = (await postResponse.json()) as { runs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  return Array.isArray(payload) ? payload : (payload.runs ?? []);
}

export async function GET(request: Request) {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) {
    return NextResponse.json(emptyMetrics());
  }

  const projectName = process.env.LANGSMITH_PROJECT ?? "BEND";
  const { searchParams } = new URL(request.url);
  const hoursRaw = Number(searchParams.get("hours") ?? DEFAULT_HOURS);
  const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : DEFAULT_HOURS;
  const startTimeIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const runs = await fetchRuns({
    apiKey,
    projectName,
    limit: MAX_LIMIT,
    startTimeIso,
  });

  if (runs.length === 0) {
    return NextResponse.json(emptyMetrics());
  }

  const latencies = runs.map(durationMsFromRun).filter((value) => value > 0).sort((a, b) => a - b);
  const avgLatencyMs = latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0;
  const p95Index = latencies.length > 0 ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1) : 0;
  const p95LatencyMs = latencies.length > 0 ? latencies[p95Index] : 0;

  const failures = runs.filter((run) => Boolean(run.error) || run.status === "error" || run.status === "failed").length;
  const errorRate = failures / runs.length;

  const commandBreakdown: Record<CommandType, number> = {
    creation: 0,
    manipulation: 0,
    layout: 0,
    complex: 0,
  };

  for (const run of runs) {
    const commandType = commandTypeFromRun(run);
    if (commandType) {
      commandBreakdown[commandType] += 1;
    }
  }

  const slowCommands = runs
    .map((run) => ({
      command: commandTextFromRun(run),
      durationMs: durationMsFromRun(run),
    }))
    .filter((item) => item.durationMs > 2000)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 50);

  return NextResponse.json({
    avgLatencyMs,
    p95LatencyMs,
    errorRate,
    commandBreakdown,
    slowCommands,
  } satisfies MetricsResponse);
}
