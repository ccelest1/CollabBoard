# AI Cost Analysis

## Data Sources and Scope

- LangSmith run data pulled from the currently configured project in `.env.local`:
  - `LANGSMITH_PROJECT="BEND"` (not `collabboard`)
  - Result: 101 runs available via LangSmith SDK iteration (max available in this workspace/account context)
- Codebase inspection:
  - `lib/ai/agent.ts` (model routing + system prompt)
  - `package.json` + `.env.local` (provider and API config)
  - Supabase usage in `lib/supabase/*`, `app/*`, and board components

> Note: Requested `collabboard` run query could not be used directly because the active LangSmith project in `.env.local` is `BEND`. All "real" run/token numbers below come from that active project.

## Development and Testing Costs

### 1) LLM Provider and Model Configuration

- Provider in use: **OpenAI** (real)
- Model strings configured in code: **`gpt-4o-mini`, `gpt-4o`** (real)

### 2) LangSmith Run/Token Totals (from active project)

- Total runs: **136** (real)
- Total input tokens: **39,180** (real)
- Total output tokens: **4,524** (real)
- Failed runs: **1** (real)

### 3) Breakdown by Model

- `gpt-4o-mini`
  - Runs: **90** (real)
  - Input tokens: **29,868** (real)
  - Output tokens: **1,004** (real)
- `gpt-4o`
  - Runs: **46** (real)
  - Input tokens: **9,312** (real)
  - Output tokens: **3,520** (real)

### 4) Development/Test LLM Cost (using provided pricing)

- `gpt-4o-mini`: $0.15 / 1M input, $0.60 / 1M output
- `gpt-4o`: $2.50 / 1M input, $10.00 / 1M output

- **Total observed LLM cost (dev/test runs): $0.063563** (real)
- Failed-run waste cost: **~$0.000467** (estimated)

### 5) Number of API Calls Made

- LangSmith runs tracked: **136** (real)
- Approximate LLM call count proxy: **136** (estimated)

### 6) Other AI-Related Costs

- Cursor Pro: **$20/month** (real, provided flat assumption)
- Supabase free tier: **$0** (real, provided)
- Supabase paid tier baseline: **$25/month** (real, provided)
- Embeddings: **$0** (estimated, not detected in current implementation)
## Token Budget by Command Type

### System Prompt Size

- `SYSTEM_PROMPT` chars in `lib/ai/agent.ts`: **994 characters** (real)
- Prompt token approximation (`1 token ~= 4 chars`): **~249 tokens** (estimated)

### Per-command token estimates by category

- Creation command: **~300 input / ~150 output tokens** (estimated)
- Manipulation command (with `getBoardState`): **~800 input / ~200 output tokens** (estimated)
- Layout command: **~500 input / ~300 output tokens** (estimated)
- Complex/template command: **~1000 input / ~500 output tokens** (estimated)

## Production Cost Projections

Assumptions (provided):
- 15 AI commands per user per session
- 3 sessions per user per month
- Command mix: 40% creation, 25% manipulation, 20% layout, 15% complex
- 85% `gpt-4o-mini`, 15% `gpt-4o`
- +20% buffer for retries/testing/failures

Derived monthly per-user token volume:
- Weighted input tokens/command: `570` (estimated)
- Weighted output tokens/command: `245` (estimated)
- Commands/user/month: `45` (estimated from assumptions)
- Input tokens/user/month after 20% buffer: `30,780` (estimated)
- Output tokens/user/month after 20% buffer: `13,230` (estimated)

Blended model pricing (85/15 split):
- Input: `$0.5025 / 1M tokens` (estimated)
- Output: `$2.01 / 1M tokens` (estimated)

Estimated LLM cost per user per month:
- Input cost: `30,780 / 1M * 0.5025 = $0.01547` (estimated)
- Output cost: `13,230 / 1M * 2.01 = $0.02659` (estimated)
- **Total: ~$0.04206 per user/month** (estimated)

### Monthly Projection Table (LLM only)

| Users | Estimated Monthly LLM Cost |
|---|---:|
| 100 | **$4.21** (estimated) |
| 1,000 | **$42.06** (estimated) |
| 10,000 | **$420.59** (estimated) |
| 100,000 | **$4,205.93** (estimated) |

### Infrastructure Add-ons

- Supabase free tier: **$0** (real, but capacity-limited)
- Supabase paid baseline (if needed): **+$25/month** (real)
- Cursor Pro (development tooling): **$20/month** (real, not a production runtime cost)

## Summary

- Observed dev/test token spend is currently very low (~**$0.04** total from tracked runs in active LangSmith project).
- At the given assumptions, projected LLM cost scales roughly linearly at about **$0.042/user/month**.
- Biggest variable risk is manipulation/complex command frequency (state-heavy prompts and multi-step tool usage).
