export type RunCostData = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  commandType?: string;
};

export type CostSummary = {
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byModel: Record<string, { runs: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  byCommandType: Record<string, { runs: number; avgInputTokens: number; avgOutputTokens: number; avgCostUsd: number }>;
};

const PRICING_PER_MILLION = {
  "gpt-4o-mini": {
    input: 0.15,
    output: 0.6,
  },
  "gpt-4o": {
    input: 2.5,
    output: 10,
  },
} as const;

function normalizeModel(model: string) {
  const lowered = model.toLowerCase();
  if (lowered.includes("gpt-4o-mini")) return "gpt-4o-mini";
  if (lowered.includes("gpt-4o")) return "gpt-4o";
  return model;
}

export function calculateRunCost(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): { inputCost: number; outputCost: number; totalCost: number } {
  const model = normalizeModel(params.model);
  const pricing =
    model === "gpt-4o-mini" || model === "gpt-4o"
      ? PRICING_PER_MILLION[model]
      : {
          input: 0,
          output: 0,
        };

  const inputCost = (Math.max(0, params.inputTokens) / 1_000_000) * pricing.input;
  const outputCost = (Math.max(0, params.outputTokens) / 1_000_000) * pricing.output;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

export function formatCostSummary(runs: RunCostData[]): CostSummary {
  const byModel: CostSummary["byModel"] = {};
  const byCommandTypeTotals: Record<string, { runs: number; inputTokens: number; outputTokens: number; totalCost: number }> = {};

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const run of runs) {
    const normalizedModel = normalizeModel(run.model || "unknown");
    const inputTokens = Math.max(0, Number(run.inputTokens) || 0);
    const outputTokens = Math.max(0, Number(run.outputTokens) || 0);
    const commandType = (run.commandType || "unknown").trim() || "unknown";
    const cost = calculateRunCost({
      model: normalizedModel,
      inputTokens,
      outputTokens,
    });

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    totalCostUsd += cost.totalCost;

    if (!byModel[normalizedModel]) {
      byModel[normalizedModel] = {
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
    }
    byModel[normalizedModel].runs += 1;
    byModel[normalizedModel].inputTokens += inputTokens;
    byModel[normalizedModel].outputTokens += outputTokens;
    byModel[normalizedModel].costUsd += cost.totalCost;

    if (!byCommandTypeTotals[commandType]) {
      byCommandTypeTotals[commandType] = {
        runs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
      };
    }
    byCommandTypeTotals[commandType].runs += 1;
    byCommandTypeTotals[commandType].inputTokens += inputTokens;
    byCommandTypeTotals[commandType].outputTokens += outputTokens;
    byCommandTypeTotals[commandType].totalCost += cost.totalCost;
  }

  const byCommandType: CostSummary["byCommandType"] = {};
  for (const [commandType, aggregate] of Object.entries(byCommandTypeTotals)) {
    const divisor = Math.max(1, aggregate.runs);
    byCommandType[commandType] = {
      runs: aggregate.runs,
      avgInputTokens: aggregate.inputTokens / divisor,
      avgOutputTokens: aggregate.outputTokens / divisor,
      avgCostUsd: aggregate.totalCost / divisor,
    };
  }

  return {
    totalRuns: runs.length,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    byModel,
    byCommandType,
  };
}
