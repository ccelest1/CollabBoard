# AI Testing Guide

## What is covered

- `tests/ai/tools.test.ts`: unit tests for all 9 structured tools and handler wiring.
- `tests/ai/commands.test.ts`: integration-style command tests through `runAgentCommand`.
- `tests/ai/panel.test.tsx`: AI panel UI behavior (open/close, chips, execute, success/error flows).
- `tests/ai/performance.test.ts`: command latency checks and LangSmith metric assertions.
- `tests/ai/multiuser.test.ts`: concurrent command execution on a shared board.

## Run tests

- One-off run:
- `npm run test:ai`
- Watch mode:
  - `npm run test:ai:watch`

## Notes on mocks vs real services

- UI tests mock `fetch` and do not call `/api/ai/command` for real.
- Command tests mock the LangGraph runtime and run against in-memory board handlers.
- Performance tests include a live LangSmith API check when `LANGSMITH_API_KEY` is available.
  - If the upstream API endpoint is unavailable, the test skips strict external assertions.

## Troubleshooting

- If tests fail with auth/trace issues, verify `.env.local`:
  - `OPENAI_API_KEY`
  - `LANGSMITH_API_KEY`
  - `LANGSMITH_TRACING=true`
  - `LANGSMITH_PROJECT=<project name>`
- If JSX test files are not detected, ensure `vitest.config.ts` includes `*.test.tsx`.
