import { readFile, writeFile } from "node:fs/promises";
import { Client as LangSmithClient } from "langsmith";
import { calculateRunCost, formatCostSummary, type RunCostData } from "../lib/ai/costTracker";

const COST_FILE = "Cost_Analysis.md";
const PROJECT_NAME = process.env.LANGSMITH_PROJECT ?? "bend";

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

async function loadRuns(days = 30) {
  const client = new LangSmithClient();
  const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const runs: Record<string, unknown>[] = [];
  const iterator = client.listRuns({
    projectName: PROJECT_NAME,
    startTime,
  });
  for await (const run of iterator) {
    runs.push(run as unknown as Record<string, unknown>);
  }
  return runs;
}

function buildUpdatedDevelopmentSection(runCosts: RunCostData[]) {
  const summary = formatCostSummary(runCosts);
  const mini = summary.byModel["gpt-4o-mini"] ?? { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const fourO = summary.byModel["gpt-4o"] ?? { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const failedRuns = runCosts.filter((run) => run.commandType === "error").length;
  const failedWasteEstimate = summary.totalRuns > 0 ? (summary.totalCostUsd * failedRuns) / summary.totalRuns : 0;

  return [
    "## Development and Testing Costs",
    "",
    "### 1) LLM Provider and Model Configuration",
    "",
    "- Provider in use: **OpenAI** (real)",
    "- Model strings configured in code: **`gpt-4o-mini`, `gpt-4o`** (real)",
    "",
    "### 2) LangSmith Run/Token Totals (from active project)",
    "",
    `- Total runs: **${summary.totalRuns.toLocaleString()}** (real)`,
    `- Total input tokens: **${summary.totalInputTokens.toLocaleString()}** (real)`,
    `- Total output tokens: **${summary.totalOutputTokens.toLocaleString()}** (real)`,
    `- Failed runs: **${failedRuns.toLocaleString()}** (real)`,
    "",
    "### 3) Breakdown by Model",
    "",
    "- `gpt-4o-mini`",
    `  - Runs: **${mini.runs.toLocaleString()}** (real)`,
    `  - Input tokens: **${mini.inputTokens.toLocaleString()}** (real)`,
    `  - Output tokens: **${mini.outputTokens.toLocaleString()}** (real)`,
    "- `gpt-4o`",
    `  - Runs: **${fourO.runs.toLocaleString()}** (real)`,
    `  - Input tokens: **${fourO.inputTokens.toLocaleString()}** (real)`,
    `  - Output tokens: **${fourO.outputTokens.toLocaleString()}** (real)`,
    "",
    "### 4) Development/Test LLM Cost (using provided pricing)",
    "",
    "- `gpt-4o-mini`: $0.15 / 1M input, $0.60 / 1M output",
    "- `gpt-4o`: $2.50 / 1M input, $10.00 / 1M output",
    "",
    `- **Total observed LLM cost (dev/test runs): $${summary.totalCostUsd.toFixed(6)}** (real)`,
    `- Failed-run waste cost: **~$${failedWasteEstimate.toFixed(6)}** (estimated)`,
    "",
    "### 5) Number of API Calls Made",
    "",
    `- LangSmith runs tracked: **${summary.totalRuns.toLocaleString()}** (real)`,
    `- Approximate LLM call count proxy: **${summary.totalRuns.toLocaleString()}** (estimated)`,
    "",
    "### 6) Other AI-Related Costs",
    "",
    "- Cursor Pro: **$20/month** (real, provided flat assumption)",
    "- Supabase free tier: **$0** (real, provided)",
    "- Supabase paid tier baseline: **$25/month** (real, provided)",
    "- Embeddings: **$0** (estimated, not detected in current implementation)",
    "",
  ].join("\n");
}

function updateCostFileContent(original: string, developmentSection: string) {
  const start = original.indexOf("## Development and Testing Costs");
  const end = original.indexOf("## Token Budget by Command Type");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Could not find expected Cost_Analysis.md section markers.");
  }
  return `${original.slice(0, start)}${developmentSection}${original.slice(end)}`;
}

function printDiff(before: string, after: string) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  let changed = false;

  for (let i = 0; i < max; i += 1) {
    const a = beforeLines[i] ?? "";
    const b = afterLines[i] ?? "";
    if (a === b) continue;
    changed = true;
    if (a) console.log(`- ${a}`);
    if (b) console.log(`+ ${b}`);
  }

  if (!changed) {
    console.log("No changes detected.");
  }
}

async function main() {
  const runs = await loadRuns(30);
  const runCosts: RunCostData[] = runs.map((run) => {
    const commandType = extractCommandType(run);
    const hasError = Boolean(run.error) || run.status === "error" || run.status === "failed";
    return {
      model: extractModel(run),
      inputTokens: extractInputTokens(run),
      outputTokens: extractOutputTokens(run),
      commandType: hasError ? "error" : commandType,
    };
  });

  const current = await readFile(COST_FILE, "utf8");
  const updatedSection = buildUpdatedDevelopmentSection(runCosts);
  const next = updateCostFileContent(current, updatedSection);
  await writeFile(COST_FILE, next, "utf8");
  printDiff(current, next);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
