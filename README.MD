# BEND Project

BEND is a collaborative whiteboard built with Next.js, Supabase realtime sync, and an AI command panel for creating/manipulating board objects with natural language.

## Links

- [Deployment Link](https://collabboard-gules.vercel.app/)
- [Demo Video](https://youtu.be/p9hib5xuHSc)
- [Social Post](https://x.com/builds_tyler/status/2025795799318253609?s=20)

## Project Docs

- [AI Development Log](AI_Development_Log.md)
- [Cost Analysis](Cost_Analysis.md)

## Tech Stack

- **Frontend:** Next.js 14, React 18, Tailwind CSS
- **Realtime + Auth + Persistence:** Supabase
- **AI:** OpenAI via LangChain (`@langchain/openai`)
- **Testing:** Vitest (AI/unit flows), Playwright (E2E/perf)

## Features

- Infinite-style whiteboard with pan/zoom and object tools
- Realtime collaborative updates
- AI command panel for:
  - object creation (sticky notes, shapes, frames, connectors)
  - object manipulation (move, resize, recolor, text update, delete)
  - template-like flows (e.g. SWOT/journey/retrospective style commands)
- AI command history + version-change recording

## Setup Guide

### 1) Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm
- Supabase project
- OpenAI API key

### 2) Install Dependencies

```bash
npm install
```

### 3) Environment Variables

Create `.env.local` in the project root and set at least:

```bash
OPENAI_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

If using server-side Supabase helpers that require a service role for local scripts/tasks, also add the project-specific server key as needed by your local setup.

### 4) Run the App

```bash
npm run dev
```

Open `http://localhost:3000`.

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - production build
- `npm run start` - run built app
- `npm run lint` - run lint checks
- `npm run test:ai` - run AI-focused Vitest suite
- `npm run test:ai:watch` - AI tests in watch mode
- `npm run test:ai:ui` - Vitest UI for AI tests
- `npm run test:e2e` - Playwright E2E tests
- `npm run test:e2e:routes` - route-focused E2E tests
- `npm run test:e2e:perf` - perf-focused E2E tests
- `npm run costs:update` - update cost analysis artifacts

## Architecture Overview

### App/API Layer

- `app/api/ai/command/route.ts`
  - Main AI command endpoint
  - Receives command + board/user context
  - Calls `runAgentCommand(...)`
- `app/api/ai/board-bounds/route.ts`
  - Returns board bounds for camera/viewport behavior
- `app/auth/callback/route.ts`
  - Auth callback flow

### AI Layer

- `lib/ai/agent.ts`
  - Executes tool plans against board mutation handlers
  - Aggregates affected objects and bounding boxes
- `lib/ai/planner.ts`
  - Converts user command into structured steps
  - Handles step references and planning validation
- `lib/ai/tools.ts`
  - Tool definitions used by the AI executor
- `lib/ai/realtimeMutationHandlers.ts`
  - Bridges AI mutations to realtime/persisted board state
- `lib/ai/boardState.ts`
  - Board-state serialization and placement helpers

### Board UI Layer

- `components/board/BoardWorkspaceV2.tsx`
  - Main board canvas workspace
  - Selection, editing, viewport, AI panel integration
- `components/board/AIAgentPanel.tsx`
  - User-facing AI chat/command panel
  - Command queue + response rendering

## Testing

### AI Tests (Vitest)

```bash
npm run test:ai
```

To run one test name:

```bash
npm run test:ai -- tests/ai/manipulation.test.ts -t "Create 10 rectangles and then delete them"
```

### E2E Tests (Playwright)

```bash
npm run test:e2e
```

## Current Notes

- AI command quality depends on prompt+planner behavior and board-state freshness.
- Realtime behavior and AI mutation consistency are sensitive to Supabase connectivity and auth/session state.
- Keep `.env.local` out of version control.
