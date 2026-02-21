import { NextResponse } from "next/server";
import { formatCostSummary, type RunCostData } from "@/lib/ai/costTracker";

const DEFAULT_DAYS = 30;
const MAX_LIMIT = 500;

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractModel(run: Record<string, unknown>) {
  return (
    ((run.extra as { metadata?: { model?: unknown } } | undefined)?.metadata?.model as string | undefined) ||
    ((run.extra as { invocation_params?: { model?: unknown } } | undefined)?.invocation_params?.model as string | undefined) ||
    (run.model as string | undefined) ||
    "unknown"
  );
}

function extractCommandType(run: Record<string, unknown>) {
  const metadataType = (run.extra as { metadata?: { commandType?: unknown } } | undefined)?.metadata?.commandType;
  if (typeof metadataType === "string" && metadataType.trim()) return metadataType;
  const tags = Array.isArray(run.tags) ? run.tags.map((tag) => String(tag)) : [];
  const match = tags.find((tag) => ["creation", "manipulation", "layout", "complex"].includes(tag));
  return match || "unknown";
}

function extractInputTokens(run: Record<string, unknown>) {
  const metadataTokens = (run.extra as { metadata?: { inputTokens?: unknown } } | undefined)?.metadata?.inputTokens;
  if (metadataTokens != null) return safeNumber(metadataTokens);

  return (
    safeNumber(run.input_tokens) ||
    safeNumber((run as { prompt_tokens?: unknown }).prompt_tokens) ||
    safeNumber((run as { usage_metadata?: { input_tokens?: unknown } }).usage_metadata?.input_tokens) ||
    safeNumber((run as { usage?: { input_tokens?: unknown } }).usage?.input_tokens) ||
    safeNumber((run.extra as { token_usage?: { prompt_tokens?: unknown; input_tokens?: unknown } } | undefined)?.token_usage?.prompt_tokens) ||
    safeNumber((run.extra as { token_usage?: { prompt_tokens?: unknown; input_tokens?: unknown } } | undefined)?.token_usage?.input_tokens)
  );
}

function extractOutputTokens(run: Record<string, unknown>) {
  const metadataTokens = (run.extra as { metadata?: { outputTokens?: unknown } } | undefined)?.metadata?.outputTokens;
  if (metadataTokens != null) return safeNumber(metadataTokens);

  return (
    safeNumber(run.output_tokens) ||
    safeNumber((run as { completion_tokens?: unknown }).completion_tokens) ||
    safeNumber((run as { usage_metadata?: { output_tokens?: unknown } }).usage_metadata?.output_tokens) ||
    safeNumber((run as { usage?: { output_tokens?: unknown } }).usage?.output_tokens) ||
    safeNumber((run.extra as { token_usage?: { completion_tokens?: unknown; output_tokens?: unknown } } | undefined)?.token_usage?.completion_tokens) ||
    safeNumber((run.extra as { token_usage?: { completion_tokens?: unknown; output_tokens?: unknown } } | undefined)?.token_usage?.output_tokens)
  );
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

  const response = await fetch(`https://api.smith.langchain.com/runs?${query.toString()}`, {
    headers,
  });
  if (response.ok) {
    const payload = (await response.json()) as { runs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    return Array.isArray(payload) ? payload : (payload.runs ?? []);
  }
  return [] as Array<Record<string, unknown>>;
}

export async function GET(request: Request) {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) {
    return NextResponse.json(formatCostSummary([]));
  }

  const { searchParams } = new URL(request.url);
  const daysRaw = Number(searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : DEFAULT_DAYS;
  const startTimeIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const runs = await fetchRuns({
    apiKey,
    projectName: "collabboard",
    limit: MAX_LIMIT,
    startTimeIso,
  });

  const runCosts: RunCostData[] = runs.map((run) => ({
    model: extractModel(run),
    inputTokens: extractInputTokens(run),
    outputTokens: extractOutputTokens(run),
    commandType: extractCommandType(run),
  }));

  return NextResponse.json(formatCostSummary(runCosts));
}
