# AI Observability

## What is traced per run

Each `runAgentCommand` invocation attaches LangSmith metadata and tracing context:

- `userId`
- `boardId`
- `commandType` (`creation`, `manipulation`, `layout`, `complex`)
- `model` (`gpt-4o-mini` or `gpt-4o`)
- tags: `bend`, `agent`, and command type
- tool calls and tool outputs (for board mutations)
- latency and status/error information from LangSmith

## Reading a multi-step trace

1. Open a run in LangSmith.
2. Identify the top-level agent run (`runName: bend-agent-command`).
3. Inspect child tool runs in execution order:
   - `getBoardState` (if used)
   - creation/mutation tools (e.g. `createFrame`, `moveObject`)
4. Verify the final AI message summary matches applied tool mutations.
5. Check metadata panel for model routing and `commandType`.

## Using the metrics dashboard

- Visit `/admin/ai-metrics` (authenticated users only).
- Click **Refresh** to fetch latest aggregate metrics from `/api/ai/metrics`.
- Pass/fail thresholds:
  - `avgLatencyMs < 2000`
  - `p95LatencyMs < 4000`
  - `errorRate < 0.05`
- Expand **Slow commands** to inspect commands above 2000ms.

## Running performance tests and cross-referencing LangSmith

1. Run AI tests:
   - `npm run test:ai`
2. Inspect `tests/ai/performance.test.ts` results for local latency expectations.
3. Cross-check with LangSmith:
   - compare p50/p95 and error rates in traces/dashboards
   - confirm command type coverage (`creation`, `manipulation`, `layout`, `complex`)

## Setting a LangSmith alert for latency > 3000ms (manual UI)

1. Open LangSmith project settings for your project.
2. Navigate to monitoring/alerts.
3. Create a new alert rule:
   - scope: runs in the AI agent project
   - condition: latency greater than `3000ms`
   - aggregation window: choose a practical interval (e.g. 5m/15m)
4. Configure notification destination (email/Slack/webhook if available).
5. Save and test with a deliberately slow command.
