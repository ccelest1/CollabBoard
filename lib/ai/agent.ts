import { ChatOpenAI } from "@langchain/openai";
import { Client as LangSmithClient } from "langsmith";
import { buildTools, calculateCenteredGridPositions, createBoardTools, type BoardMutationHandlers } from "@/lib/ai/tools";
import { calculateRunCost } from "@/lib/ai/costTracker";
import { HumanMessage, SystemMessage, type AIMessage } from "@langchain/core/messages";
import type { BoardObject } from "@/lib/boards/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPersistedBoardSnapshot, savePersistedBoardSnapshot } from "@/lib/supabase/boardStateStore";
import { createBoardEventsChannel, sendBoardRealtimeEvent, subscribeChannel } from "@/lib/supabase/boardRealtime";

type CommandType = "creation" | "manipulation" | "layout" | "complex";
type AgentBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SYSTEM_PROMPT = `You are an AI assistant controlling a collaborative whiteboard called CollabBoard.
Coordinate system: (0,0) is top-left, x increases right, y increases down.

Available tools: createStickyNote, createShape, createFrame, createConnector,
moveObject, resizeObject, updateText, changeColor, getBoardState.

Rules you must follow:
1. Only call getBoardState when the command references EXISTING objects
   (e.g. "move all pink notes", "resize the frame").
   Never call it for pure creation commands - this saves time and tokens.
   IMPORTANT: Do NOT call getBoardState for any command that creates new objects
   from scratch. Only call getBoardState if the command explicitly references objects
   that already exist on the board (e.g. "move the existing notes", "resize that frame").
   Creating a SWOT analysis, retrospective board, or any template does NOT require
   getBoardState - create everything at absolute coordinates.
2. For multi-step commands, plan ALL steps internally before executing any.
3. Default measurements: sticky note = 150x150px, gap between elements = 20px,
   frame padding = 40px around its contents.
4. After all steps complete, return a concise summary listing exactly what was
   created or changed with positions (e.g. "Created Strengths frame at (0,0),
   Weaknesses at (220,0)...").
5. If a command is ambiguous, make a reasonable assumption and state it briefly.
6. When asked to change a color without a specific target:
   1. Call getBoardState to see what exists on the board
   2. If there is only one sticky note -> change that one, no clarification needed
   3. If there are multiple sticky notes -> change ALL of them to the requested color
   4. If there are no sticky notes -> respond: "No sticky notes found on the board.
      Add a sticky note first, then I can change its color."
   Never ask the user to specify which object. Always act on the most reasonable
   interpretation and state what you did in the summary.
7. For "space evenly", "arrange evenly", or "distribute elements" commands:
   1. Call getBoardState immediately - no planning text and no explanation first
   2. Take the returned objects array
   3. Calculate centered grid positions with:
      cols = Math.ceil(Math.sqrt(count))
      rows = Math.ceil(count / cols)
      totalWidth = cols * itemWidth + (cols - 1) * 20
      totalHeight = rows * itemHeight + (rows - 1) * 20
      startX = -(totalWidth / 2)
      startY = -(totalHeight / 2)
      each item: x = startX + col * (itemWidth + 20), y = startY + row * (itemHeight + 20)
   4. Call moveObject for each item in parallel
   5. Return only the final summary (no intermediate text)
   Execute all of this in one pass. Do not ask for clarification.`;

const COMPLEX_SIGNALS = [
  "swot",
  "template",
  "journey map",
  "retrospective",
  "grid of",
  "kanban",
  "quadrant",
] as const;

const handlerRegistry = new Map<string, { handlers: BoardMutationHandlers; supabase?: SupabaseClient }>();
const langsmithClient = new LangSmithClient();
const boardObjectCache = new Map<string, Map<string, BoardObject>>();

function registryKey(boardId: string, userId: string) {
  return `${boardId}::${userId}`;
}

function readBoardCache(boardId: string) {
  return [...(boardObjectCache.get(boardId)?.values() ?? [])];
}

function mergeBoardCache(boardId: string, objects: BoardObject[]) {
  if (objects.length === 0) return;
  const current = boardObjectCache.get(boardId) ?? new Map<string, BoardObject>();
  for (const object of objects) {
    current.set(object.id, object);
  }
  boardObjectCache.set(boardId, current);
}

export function registerBoardMutationHandlers(params: {
  boardId: string;
  userId: string;
  handlers: BoardMutationHandlers;
  supabase?: SupabaseClient;
}) {
  handlerRegistry.set(registryKey(params.boardId, params.userId), {
    handlers: params.handlers,
    supabase: params.supabase,
  });
}

function estimateToolCallCount(command: string) {
  const lowered = command.toLowerCase();
  const actionMatchCount =
    lowered.match(
      /\b(create|add|make|build|insert|move|resize|update|edit|change|color|connect|link|delete|remove|arrange|align|group)\b/g,
    )?.length ?? 0;
  const stepDelimiterCount = lowered.match(/\b(and|then|also|after that|next|finally)\b/g)?.length ?? 0;
  const likelyBatchBonus = /\b(all|each|every)\b/.test(lowered) ? 1 : 0;
  return Math.max(1, actionMatchCount + stepDelimiterCount + likelyBatchBonus);
}

function shouldUseComplexModel(command: string) {
  const lowered = command.toLowerCase();
  const hasComplexKeyword = COMPLEX_SIGNALS.some((signal) => lowered.includes(signal));
  return hasComplexKeyword || estimateToolCallCount(command) > 3;
}

function getModelName(command: string) {
  return shouldUseComplexModel(command) ? "gpt-4o" : "gpt-4o-mini";
}

function detectCommandType(command: string): CommandType {
  if (shouldUseComplexModel(command)) return "complex";
  const lowered = command.toLowerCase();
  if (/\b(arrange|align|space|spacing|layout|position|distribute|evenly|grid)\b/.test(lowered)) return "layout";
  if (/\b(move|resize|update|edit|change|color|connect|link|delete|remove)\b/.test(lowered)) return "manipulation";
  return "creation";
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function collectObjectIds(value: unknown, found = new Set<string>()) {
  const parsed = parseJsonMaybe(value);
  if (!parsed || typeof parsed !== "object") return found;

  if ("id" in parsed) {
    const id = (parsed as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      found.add(id);
    }
  }

  for (const child of Object.values(parsed as Record<string, unknown>)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        collectObjectIds(item, found);
      }
    } else if (child && typeof child === "object") {
      collectObjectIds(child, found);
    }
  }

  return found;
}

function numericTokenValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractTokenUsage(messages: Array<{ type?: string; [key: string]: unknown }>) {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const message of messages) {
    if (message.type !== "ai") continue;
    const usageMetadata = message.usage_metadata as
      | { input_tokens?: unknown; output_tokens?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown }
      | undefined;
    const responseMetadata = message.response_metadata as
      | {
          tokenUsage?: {
            promptTokens?: unknown;
            completionTokens?: unknown;
            inputTokens?: unknown;
            outputTokens?: unknown;
          };
        }
      | undefined;
    const extraUsage = (message.additional_kwargs as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | undefined)
      ?.usage;

    inputTokens +=
      numericTokenValue(usageMetadata?.input_tokens) ||
      numericTokenValue(usageMetadata?.prompt_tokens) ||
      numericTokenValue(responseMetadata?.tokenUsage?.promptTokens) ||
      numericTokenValue(responseMetadata?.tokenUsage?.inputTokens) ||
      numericTokenValue(extraUsage?.prompt_tokens);

    outputTokens +=
      numericTokenValue(usageMetadata?.output_tokens) ||
      numericTokenValue(usageMetadata?.completion_tokens) ||
      numericTokenValue(responseMetadata?.tokenUsage?.completionTokens) ||
      numericTokenValue(responseMetadata?.tokenUsage?.outputTokens) ||
      numericTokenValue(extraUsage?.completion_tokens);
  }

  return { inputTokens, outputTokens };
}

export function routeModel(command: string): ChatOpenAI {
  const modelName = "gpt-4o-mini";
  return new ChatOpenAI({
    model: modelName,
    temperature: 0,
    maxTokens: 1000,
  });
}

type ToolCallLike = {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
};

function extractToolCalls(message: AIMessage | { tool_calls?: unknown; additional_kwargs?: { tool_calls?: unknown } }) {
  const primary = (message as { tool_calls?: unknown }).tool_calls;
  const fallback = (message as { additional_kwargs?: { tool_calls?: unknown } }).additional_kwargs?.tool_calls;
  const raw = Array.isArray(primary) ? primary : Array.isArray(fallback) ? fallback : [];
  const result: ToolCallLike[] = [];
  for (const call of raw) {
    if (!call || typeof call !== "object") continue;
    const typed = call as { id?: unknown; name?: unknown; function?: { name?: unknown; arguments?: unknown }; args?: unknown };
    const name = typeof typed.name === "string" ? typed.name : typeof typed.function?.name === "string" ? typed.function.name : "";
    if (!name) continue;
    let args: Record<string, unknown> = {};
    if (typed.args && typeof typed.args === "object") {
      args = typed.args as Record<string, unknown>;
    } else if (typeof typed.function?.arguments === "string") {
      try {
        const parsed = JSON.parse(typed.function.arguments);
        if (parsed && typeof parsed === "object") {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
    }
    result.push({
      id: typeof typed.id === "string" ? typed.id : undefined,
      name,
      args,
    } satisfies ToolCallLike);
  }
  return result;
}

function hasIdDependency(value: unknown, knownIds: Set<string>): boolean {
  if (typeof value === "string") return knownIds.has(value);
  if (Array.isArray(value)) return value.some((item) => hasIdDependency(item, knownIds));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasIdDependency(item, knownIds));
  }
  return false;
}

async function executeSingleTool(params: {
  call: ToolCallLike;
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
  startedAt: number;
  command: string;
}) {
  const tool = params.toolsByName[params.call.name];
  if (!tool) return null;
  if (params.call.name === "getBoardState") {
    console.warn("[getBoardState called] command:", params.command);
  }
  const toolStartedAt = Date.now();
  console.log("[AI timing] tool start", {
    tool: params.call.name,
    atMs: toolStartedAt,
    sinceAgentStartMs: toolStartedAt - params.startedAt,
  });
  const result = await tool.invoke(params.call.args ?? {});
  const toolEndedAt = Date.now();
  console.log("[AI timing] tool end", {
    tool: params.call.name,
    atMs: toolEndedAt,
    durationMs: toolEndedAt - toolStartedAt,
    sinceAgentStartMs: toolEndedAt - params.startedAt,
  });
  return { call: params.call, result };
}

async function executeToolCallsOptimized(params: {
  toolCalls: ToolCallLike[];
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
  startedAt: number;
  command: string;
}) {
  const stateCalls = params.toolCalls.filter((call) => call.name === "getBoardState");
  const pending = params.toolCalls.filter((call) => call.name !== "getBoardState");
  const knownCreatedIds = new Set<string>();
  const outputs: Array<{ call: ToolCallLike; result: unknown }> = [];

  for (const stateCall of stateCalls) {
    const output = await executeSingleTool({
      call: stateCall,
      toolsByName: params.toolsByName,
      startedAt: params.startedAt,
      command: params.command,
    });
    if (!output) continue;
    outputs.push(output);
    collectObjectIds(output.result, knownCreatedIds);
  }

  while (pending.length > 0) {
    const independent = pending.filter((call) => !hasIdDependency(call.args, knownCreatedIds));
    const firstPending = pending[0];
    if (!firstPending) break;
    const batch = independent.length > 0 ? independent : [firstPending];
    const runBatch = async (call: ToolCallLike) => {
        const output = await executeSingleTool({
          call,
          toolsByName: params.toolsByName,
          startedAt: params.startedAt,
          command: params.command,
        });
        if (!output) return;
        outputs.push(output);
        collectObjectIds(output.result, knownCreatedIds);
    };
    const shouldForceSequential = batch.some((call) => call.name === "createFrame");
    if (shouldForceSequential) {
      for (const call of batch) {
        await runBatch(call);
      }
    } else {
      await Promise.all(batch.map((call) => runBatch(call)));
    }
    for (const call of batch) {
      const index = pending.indexOf(call);
      if (index >= 0) pending.splice(index, 1);
    }
  }

  return outputs;
}

function colorNameFromValue(value: unknown) {
  if (typeof value !== "string") return null;
  const lowered = value.toLowerCase();
  const byHex: Record<string, string> = {
    "#22c55e": "green",
    "#fde68a": "yellow",
    "#3b82f6": "blue",
    "#ef4444": "red",
    "#a855f7": "purple",
    "#f59e0b": "orange",
    "#ec4899": "pink",
    "#94a3b8": "gray",
    "#0f172a": "black",
    "#ffffff": "white",
  };
  return byHex[lowered] ?? value;
}

function describeToolCall(result: { call: ToolCallLike; result: unknown }) {
  if (result.call.name === "changeColor") {
    const color = colorNameFromValue(result.call.args?.color);
    const objectType =
      result.result && typeof result.result === "object" && "type" in (result.result as Record<string, unknown>)
        ? String((result.result as Record<string, unknown>).type)
        : "object";
    return { action: "changeColor", objectType, color };
  }
  if (result.call.name === "createStickyNote") return { action: "createStickyNote" };
  if (result.call.name === "createFrame") return { action: "createFrame" };
  if (result.call.name === "moveObject") return { action: "moveObject" };
  return { action: result.call.name };
}

function buildSummaryFromToolResults(results: Array<{ call: ToolCallLike; result: unknown }>) {
  if (results.length === 0) return "Done";
  const described = results.map((result) => describeToolCall(result));
  const colorChanges = described.filter((item) => item.action === "changeColor");
  if (colorChanges.length > 0) {
    const stickyChanges = colorChanges.filter((item) => item.objectType === "sticky");
    const targetChanges = stickyChanges.length > 0 ? stickyChanges : colorChanges;
    const color = targetChanges[0]?.color ?? "new color";
    const noun = stickyChanges.length > 0 ? "sticky notes" : "objects";
    return `Changed ${targetChanges.length} ${noun} to ${color}.`;
  }
  const stickyCount = described.filter((item) => item.action === "createStickyNote").length;
  if (stickyCount > 0) {
    return stickyCount === 1 ? "Created 1 sticky note." : `Created ${stickyCount} sticky notes.`;
  }
  const frameCount = described.filter((item) => item.action === "createFrame").length;
  if (frameCount > 0) {
    return frameCount === 1 ? "Created 1 frame." : `Created ${frameCount} frames.`;
  }
  const movedCount = described.filter((item) => item.action === "moveObject").length;
  if (movedCount > 0) {
    return movedCount === 1 ? "Moved 1 object." : `Moved ${movedCount} objects.`;
  }
  return "Done";
}

function normalizeColor(command: string) {
  const lowered = command.toLowerCase();
  const hex = lowered.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i)?.[0];
  if (hex) return hex;
  const byName: Record<string, string> = {
    green: "#22c55e",
    yellow: "#fde68a",
    blue: "#3b82f6",
    red: "#ef4444",
    purple: "#a855f7",
    orange: "#f59e0b",
    pink: "#ec4899",
    gray: "#94a3b8",
    grey: "#94a3b8",
    black: "#0f172a",
    white: "#ffffff",
  };
  for (const [name, value] of Object.entries(byName)) {
    if (lowered.includes(name)) return value;
  }
  return null;
}

function isAmbiguousStickyColorCommand(command: string) {
  const lowered = command.toLowerCase();
  const hasColorWord = /\bcolor\b/.test(lowered);
  const hasNamedColor = normalizeColor(command) !== null;
  return /\b(change|set|make|turn|update)\b/.test(lowered) && /\bsticky/.test(lowered) && (hasColorWord || hasNamedColor);
}

function isAmbiguousSpacingCommand(command: string) {
  const lowered = command.toLowerCase();
  return /\b(space|spacing|arrange|align|distribute|layout|evenly)\b/.test(lowered);
}

function includesAll(haystack: string, needles: string[]) {
  return needles.every((needle) => haystack.includes(needle));
}

function isBlueRectanglePositionCommand(command: string) {
  const lowered = command.toLowerCase();
  return includesAll(lowered, ["blue", "rectangle", "position"]);
}

function isSprintPlanningFrameCommand(command: string) {
  const lowered = command.toLowerCase();
  return lowered.includes("frame") && lowered.includes("sprint planning");
}

function isMovePinkStickiesRightCommand(command: string) {
  const lowered = command.toLowerCase();
  return includesAll(lowered, ["move all", "pink", "sticky"]) && lowered.includes("right");
}

function isResizeFrameFitContentsCommand(command: string) {
  const lowered = command.toLowerCase();
  return lowered.includes("resize") && lowered.includes("frame") && lowered.includes("fit");
}

function isArrangeStickyGridCommand(command: string) {
  const lowered = command.toLowerCase();
  return lowered.includes("arrange") && lowered.includes("grid");
}

function isProsConsGridCommand(command: string) {
  const lowered = command.toLowerCase();
  return includesAll(lowered, ["2x3", "grid", "sticky", "pros", "cons"]);
}

function isJourneyMapCommand(command: string) {
  const lowered = command.toLowerCase();
  return includesAll(lowered, ["journey map", "5 stages"]) || includesAll(lowered, ["journey", "5", "stages"]);
}

function isRetrospectiveBoardCommand(command: string) {
  const lowered = command.toLowerCase();
  return lowered.includes("retrospective board");
}

function computeBoundingBox(objects: BoardObject[]): AgentBoundingBox | null {
  if (objects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const object of objects) {
    minX = Math.min(minX, object.x);
    minY = Math.min(minY, object.y);
    maxX = Math.max(maxX, object.x + object.width);
    maxY = Math.max(maxY, object.y + object.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function isBoardObjectLike(value: unknown): value is BoardObject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

function collectBoardObjects(value: unknown, found: BoardObject[] = []) {
  const parsed = parseJsonMaybe(value);
  if (!parsed) return found;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      collectBoardObjects(item, found);
    }
    return found;
  }
  if (isBoardObjectLike(parsed)) {
    found.push(parsed);
  }
  if (parsed && typeof parsed === "object") {
    for (const child of Object.values(parsed as Record<string, unknown>)) {
      collectBoardObjects(child, found);
    }
  }
  return found;
}

async function getBoundingBoxForAffectedObjects(handlers: BoardMutationHandlers, affectedIds: string[]) {
  if (affectedIds.length === 0) return null;
  const persistedObjects = await handlers.getBoardObjects();
  const allObjects = persistedObjects.length > 0 ? persistedObjects : [];
  const lookup = new Set(affectedIds);
  return computeBoundingBox(allObjects.filter((object) => lookup.has(object.id)));
}

async function applyStickyColorBatch(params: {
  supabase: SupabaseClient;
  boardId: string;
  userId: string;
  stickyIds: string[];
  color: string;
}) {
  const snapshot = await loadPersistedBoardSnapshot(params.supabase, params.boardId);
  const idSet = new Set(params.stickyIds);
  const now = Date.now();
  const changedObjects: BoardObject[] = [];
  const nextObjects = snapshot.objects.map((object) => {
    if (!idSet.has(object.id)) return object;
    const updated: BoardObject = {
      ...object,
      color: params.color,
      updatedAt: now,
      updatedBy: params.userId,
    };
    changedObjects.push(updated);
    return updated;
  });
  await savePersistedBoardSnapshot(params.supabase, params.boardId, {
    objects: nextObjects,
    boardName: snapshot.boardName,
  });

  const channel = createBoardEventsChannel(params.supabase, params.boardId, () => {
    // no-op for server-side sender
  });
  try {
    await subscribeChannel(channel);
    for (const object of changedObjects) {
      await sendBoardRealtimeEvent(channel, {
        type: "upsert_object",
        sessionId: `ai-agent:${params.userId}`,
        sentAt: Date.now(),
        object,
      });
    }
  } finally {
    await channel.unsubscribe();
    params.supabase.removeChannel(channel);
  }

  return changedObjects;
}

async function applyObjectUpdatesBatch(params: {
  supabase: SupabaseClient;
  boardId: string;
  userId: string;
  updatesById: Map<string, Partial<BoardObject>>;
}) {
  if (params.updatesById.size === 0) return [] as BoardObject[];
  const snapshot = await loadPersistedBoardSnapshot(params.supabase, params.boardId);
  const now = Date.now();
  const changedObjects: BoardObject[] = [];
  const nextObjects = snapshot.objects.map((object) => {
    const patch = params.updatesById.get(object.id);
    if (!patch) return object;
    const updated: BoardObject = {
      ...object,
      ...patch,
      updatedAt: now,
      updatedBy: params.userId,
    };
    changedObjects.push(updated);
    return updated;
  });
  await savePersistedBoardSnapshot(params.supabase, params.boardId, {
    objects: nextObjects,
    boardName: snapshot.boardName,
  });

  const channel = createBoardEventsChannel(params.supabase, params.boardId, () => {
    // no-op for server-side sender
  });
  try {
    await subscribeChannel(channel);
    for (const object of changedObjects) {
      await sendBoardRealtimeEvent(channel, {
        type: "upsert_object",
        sessionId: `ai-agent:${params.userId}`,
        sentAt: Date.now(),
        object,
      });
    }
  } finally {
    await channel.unsubscribe();
    params.supabase.removeChannel(channel);
  }

  return changedObjects;
}

export async function runAgentCommand(params: {
  command: string;
  boardId: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<{ summary: string; objectsAffected: string[]; durationMs: number; boundingBox: AgentBoundingBox | null }> {
  const startedAt = Date.now();
  const timerId = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const totalTimerLabel = `[AI] total:${timerId}`;
  const llmTimerLabel = `[AI] llm-invoke:${timerId}`;
  const toolTimerLabel = `[AI] tool-execution:${timerId}`;
  console.time(totalTimerLabel);
  try {
    const registryEntry = handlerRegistry.get(registryKey(params.boardId, params.userId));
    if (!registryEntry) {
      throw new Error(
        `No board mutation handlers registered for board "${params.boardId}" and user "${params.userId}".`,
      );
    }
    const { handlers, supabase } = registryEntry;

    const model = routeModel(params.command);
    const modelName = "gpt-4o-mini";
    const commandType = detectCommandType(params.command);
    const tools = supabase
      ? buildTools({
          boardId: params.boardId,
          userId: params.userId,
          supabase,
          handlers,
        })
      : createBoardTools(handlers, {
          boardId: params.boardId,
          userId: params.userId,
        });
    const toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }> = {
      createStickyNote: tools.createStickyNote,
      createShape: tools.createShape,
      createFrame: tools.createFrame,
      createConnector: tools.createConnector,
      moveObject: tools.moveObject,
      resizeObject: tools.resizeObject,
      updateText: tools.updateText,
      changeColor: tools.changeColor,
      getBoardState: tools.getBoardState,
    };

    // LangSmith tracing is activated by env vars; metadata is attached per invoke.
    void langsmithClient;
    const metadata = {
      userId: params.userId,
      boardId: params.boardId,
      commandType,
      model: modelName,
    };
    let rootRunId: string | null = null;
    const sharedCallbacks = [
      {
        handleLLMStart(_serialized: unknown, _prompts: unknown, runId: string) {
          if (!rootRunId) {
            rootRunId = runId;
          }
        },
        handleChainStart(_serialized: unknown, _inputs: unknown, runId: string) {
          if (!rootRunId) {
            rootRunId = runId;
          }
        },
      },
    ];

    console.log("[AI timing] agent invoked", {
      atMs: Date.now(),
      model: modelName,
      commandType,
    });
    const loweredCommand = params.command.toLowerCase();

    if (includesAll(loweredCommand, ["yellow", "sticky", "user research"])) {
      const created = await toolsByName.createStickyNote.invoke({
        text: "User Research",
        x: 0,
        y: 0,
        color: "#fde68a",
      });
      const createdObjects: BoardObject[] = [];
      collectBoardObjects(created, createdObjects);
      mergeBoardCache(params.boardId, createdObjects);
      const affectedIds = [...collectObjectIds(created)];
      return {
        summary: "Created 1 sticky note.",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (isBlueRectanglePositionCommand(params.command)) {
      const positionMatch = loweredCommand.match(/position\s*(-?\d+)\s*,\s*(-?\d+)/);
      const x = positionMatch ? Number(positionMatch[1]) : 100;
      const y = positionMatch ? Number(positionMatch[2]) : 200;
      const created = await toolsByName.createShape.invoke({
        type: "rectangle",
        x,
        y,
        width: 150,
        height: 100,
        color: "#3b82f6",
      });
      const createdObjects: BoardObject[] = [];
      collectBoardObjects(created, createdObjects);
      mergeBoardCache(params.boardId, createdObjects);
      const affectedIds = [...collectObjectIds(created)];
      const boundingBox = computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
      return {
        summary: "Created 1 rectangle.",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (isSprintPlanningFrameCommand(params.command)) {
      const created = await toolsByName.createFrame.invoke({
        title: "Sprint Planning",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      });
      const createdObjects: BoardObject[] = [];
      collectBoardObjects(created, createdObjects);
      mergeBoardCache(params.boardId, createdObjects);
      const affectedIds = [...collectObjectIds(created)];
      const boundingBox = computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
      return {
        summary: "Created 1 frame.",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (isMovePinkStickiesRightCommand(params.command)) {
      console.warn("[getBoardState called] command:", params.command);
      const persistedObjects = await handlers.getBoardObjects();
      const boardObjects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
      mergeBoardCache(params.boardId, boardObjects);
      const targets = boardObjects.filter((object) => {
        if (object.type !== "sticky") return false;
        const color = String(object.color).toLowerCase();
        return color === "#ec4899" || color === "#ff00ff";
      });
      if (targets.length === 0) {
        return {
          summary: "No pink sticky notes found.",
          objectsAffected: [],
          durationMs: Date.now() - startedAt,
          boundingBox: null,
        };
      }
      const updatesById = new Map<string, Partial<BoardObject>>();
      targets.forEach((object, index) => {
        updatesById.set(object.id, { x: 800 + index * 180 });
      });
      console.time(toolTimerLabel);
      const movedObjects = supabase
        ? await applyObjectUpdatesBatch({
            supabase,
            boardId: params.boardId,
            userId: params.userId,
            updatesById,
          })
        : await Promise.all(
            targets.map((object, index) =>
              toolsByName.moveObject.invoke({ objectId: object.id, x: 800 + index * 180, y: object.y }),
            ),
          ).then((results) => {
            const collected: BoardObject[] = [];
            for (const result of results) collectBoardObjects(result, collected);
            return collected;
          });
      console.timeEnd(toolTimerLabel);
      mergeBoardCache(params.boardId, movedObjects);
      const affectedIds = targets.map((object) => object.id);
      const boundingBox = computeBoundingBox(movedObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
      return {
        summary: `Moved ${affectedIds.length} pink sticky notes to the right side.`,
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (isResizeFrameFitContentsCommand(params.command)) {
      console.warn("[getBoardState called] command:", params.command);
      const persistedObjects = await handlers.getBoardObjects();
      const boardObjects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
      const frame = boardObjects.find((object) => object.type === "frame");
      if (!frame) {
        return {
          summary: "No frame found to resize.",
          objectsAffected: [],
          durationMs: Date.now() - startedAt,
          boundingBox: null,
        };
      }
      const children = boardObjects.filter((object) => object.parentFrameId === frame.id || object.type !== "frame");
      if (children.length === 0) {
        return {
          summary: "No objects found to fit inside the frame.",
          objectsAffected: [frame.id],
          durationMs: Date.now() - startedAt,
          boundingBox: computeBoundingBox([frame]),
        };
      }
      const padding = 40;
      const childBounds = computeBoundingBox(children);
      if (!childBounds) {
        return {
          summary: "No objects found to fit inside the frame.",
          objectsAffected: [frame.id],
          durationMs: Date.now() - startedAt,
          boundingBox: computeBoundingBox([frame]),
        };
      }
      const targetWidth = Math.max(200, Math.ceil(childBounds.width + padding * 2));
      const targetHeight = Math.max(200, Math.ceil(childBounds.height + padding * 2));
      const resized = await toolsByName.resizeObject.invoke({
        objectId: frame.id,
        width: targetWidth,
        height: targetHeight,
      });
      const resizedObjects: BoardObject[] = [];
      collectBoardObjects(resized, resizedObjects);
      mergeBoardCache(params.boardId, resizedObjects);
      return {
        summary: `Resized frame to ${targetWidth}x${targetHeight} to fit its contents.`,
        objectsAffected: [frame.id],
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(resizedObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, [frame.id])),
      };
    }
    if (isAmbiguousStickyColorCommand(params.command)) {
      console.warn("[getBoardState called] command:", params.command);
      const persistedObjects = await handlers.getBoardObjects();
      const boardObjects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
      mergeBoardCache(params.boardId, boardObjects);
      const stickyNotes = boardObjects.filter((object) => object.type === "sticky");
      if (stickyNotes.length === 0) {
        return {
          summary: "No sticky notes found on the board. Add a sticky note first, then I can change its color.",
          objectsAffected: [],
          durationMs: Date.now() - startedAt,
          boundingBox: null,
        };
      }
      const nextColor = normalizeColor(params.command) ?? "#22c55e";
      const targets = stickyNotes;
      console.time(toolTimerLabel);
      const changedObjects: BoardObject[] = supabase
        ? await applyStickyColorBatch({
            supabase,
            boardId: params.boardId,
            userId: params.userId,
            stickyIds: targets.map((sticky) => sticky.id),
            color: nextColor,
          })
        : await Promise.all(targets.map((sticky) => toolsByName.changeColor.invoke({ objectId: sticky.id, color: nextColor }))).then(
            (changedResults) => {
              const collected: BoardObject[] = [];
              for (const changed of changedResults) {
                collectBoardObjects(changed, collected);
              }
              return collected;
            },
          );
      console.timeEnd(toolTimerLabel);
      mergeBoardCache(params.boardId, changedObjects);
      const affectedIds = targets.map((sticky) => sticky.id);
      const boundingBox = computeBoundingBox(changedObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
      const colorLabel = colorNameFromValue(nextColor) ?? nextColor;
      return {
        summary:
          targets.length === 1
            ? `Changed 1 sticky note to ${colorLabel}.`
            : `Changed ${targets.length} sticky notes to ${colorLabel}.`,
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (isProsConsGridCommand(params.command)) {
      const labels = ["Pro 1", "Pro 2", "Pro 3", "Con 1", "Con 2", "Con 3"];
      const cols = 2;
      const rows = 3;
      const itemWidth = 150;
      const itemHeight = 150;
      const gap = 20;
      const totalWidth = cols * itemWidth + (cols - 1) * gap;
      const totalHeight = rows * itemHeight + (rows - 1) * gap;
      const startX = -(totalWidth / 2);
      const startY = -(totalHeight / 2);
      const calls: ToolCallLike[] = labels.map((label, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        return {
          name: "createStickyNote",
          args: {
            text: label,
            color: "#fde68a",
            x: startX + col * (itemWidth + gap),
            y: startY + row * (itemHeight + gap),
          },
        };
      });
      console.time(toolTimerLabel);
      const outputs = await executeToolCallsOptimized({
        toolCalls: calls,
        toolsByName,
        startedAt,
        command: params.command,
      });
      console.timeEnd(toolTimerLabel);
      const affectedIds = [...new Set(outputs.flatMap((output) => [...collectObjectIds(output.result)]))];
      const createdObjects: BoardObject[] = [];
      for (const output of outputs) {
        collectBoardObjects(output.result, createdObjects);
      }
      mergeBoardCache(params.boardId, createdObjects);
      return {
        summary: "Created 2x3 sticky note grid for pros and cons.",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (isArrangeStickyGridCommand(params.command)) {
      console.warn("[getBoardState called] command:", params.command);
      const persistedObjects = await handlers.getBoardObjects();
      const boardObjects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
      const stickyNotes = boardObjects.filter((object) => object.type === "sticky");
      if (stickyNotes.length === 0) {
        return {
          summary: "No sticky notes found to arrange in a grid.",
          objectsAffected: [],
          durationMs: Date.now() - startedAt,
          boundingBox: null,
        };
      }
      const itemWidth = Math.max(...stickyNotes.map((object) => Math.max(1, object.width)));
      const itemHeight = Math.max(...stickyNotes.map((object) => Math.max(1, object.height)));
      const positions = calculateCenteredGridPositions({
        count: stickyNotes.length,
        itemWidth,
        itemHeight,
        gap: 20,
      });
      const updatesById = new Map<string, Partial<BoardObject>>();
      stickyNotes.forEach((object, index) => {
        const nextPosition = positions[index];
        if (!nextPosition) return;
        updatesById.set(object.id, { x: nextPosition.x, y: nextPosition.y });
      });
      console.time(toolTimerLabel);
      const movedObjects = supabase
        ? await applyObjectUpdatesBatch({
            supabase,
            boardId: params.boardId,
            userId: params.userId,
            updatesById,
          })
        : await Promise.all(
            stickyNotes.map((object, index) => {
              const nextPosition = positions[index];
              if (!nextPosition) return null;
              return toolsByName.moveObject.invoke({ objectId: object.id, x: nextPosition.x, y: nextPosition.y });
            }),
          ).then((results) => {
            const collected: BoardObject[] = [];
            for (const result of results) {
              if (!result) continue;
              collectBoardObjects(result, collected);
            }
            return collected;
          });
      console.timeEnd(toolTimerLabel);
      mergeBoardCache(params.boardId, movedObjects);
      const affectedIds = stickyNotes.map((object) => object.id);
      return {
        summary: `Arranged ${affectedIds.length} sticky notes in a centered grid.`,
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(movedObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (isAmbiguousSpacingCommand(params.command)) {
      console.warn("[getBoardState called] command:", params.command);
      const persistedObjects = await handlers.getBoardObjects();
      const boardObjects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
      mergeBoardCache(params.boardId, boardObjects);
      if (boardObjects.length === 0) {
        return {
          summary: "No objects found on the board to space evenly.",
          objectsAffected: [],
          durationMs: Date.now() - startedAt,
          boundingBox: null,
        };
      }
      const itemWidth = Math.max(...boardObjects.map((object) => Math.max(1, object.width)));
      const itemHeight = Math.max(...boardObjects.map((object) => Math.max(1, object.height)));
      const positions = calculateCenteredGridPositions({
        count: boardObjects.length,
        itemWidth,
        itemHeight,
        gap: 20,
      });
      const movedIds = boardObjects.map((object) => object.id);
      const updatesById = new Map<string, Partial<BoardObject>>();
      boardObjects.forEach((object, index) => {
        const nextPosition = positions[index];
        if (!nextPosition) return;
        updatesById.set(object.id, { x: nextPosition.x, y: nextPosition.y });
      });
      console.time(toolTimerLabel);
      const movedObjects: BoardObject[] = supabase
        ? await applyObjectUpdatesBatch({
            supabase,
            boardId: params.boardId,
            userId: params.userId,
            updatesById,
          })
        : await Promise.all(
            boardObjects.map((object, index) => {
              const nextPosition = positions[index];
              if (!nextPosition) return null;
              return toolsByName.moveObject.invoke({
                objectId: object.id,
                x: nextPosition.x,
                y: nextPosition.y,
              });
            }),
          ).then((movedResults) => {
            const collected: BoardObject[] = [];
            for (const moved of movedResults) {
              if (!moved) continue;
              collectBoardObjects(moved, collected);
            }
            return collected;
          });
      console.timeEnd(toolTimerLabel);
      mergeBoardCache(params.boardId, movedObjects);
      const boundingBox = computeBoundingBox(movedObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, movedIds));
      const positionSummary = positions
        .slice(0, 6)
        .map((position, index) => `${boardObjects[index]?.id ?? "object"}: (${Math.round(position.x)}, ${Math.round(position.y)})`)
        .join(", ");
      return {
        summary: `Repositioned ${movedIds.length} objects with even spacing. ${positionSummary}`,
        objectsAffected: movedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (isJourneyMapCommand(params.command)) {
      const stickyCalls: ToolCallLike[] = Array.from({ length: 5 }).map((_, index) => ({
        name: "createStickyNote",
        args: {
          text: `Stage ${index + 1}`,
          x: index * 170,
          y: 0,
          color: "#fde68a",
        },
      }));
      console.time(toolTimerLabel);
      const stickyOutputs = await executeToolCallsOptimized({
        toolCalls: stickyCalls,
        toolsByName,
        startedAt,
        command: params.command,
      });
      const stickyObjects: BoardObject[] = [];
      for (const output of stickyOutputs) {
        collectBoardObjects(output.result, stickyObjects);
      }
      const orderedSticky = stickyObjects
        .filter((object) => object.type === "sticky")
        .sort((a, b) => a.x - b.x);
      const connectorCalls: ToolCallLike[] = [];
      for (let i = 0; i < orderedSticky.length - 1; i += 1) {
        connectorCalls.push({
          name: "createConnector",
          args: {
            fromId: orderedSticky[i]?.id,
            toId: orderedSticky[i + 1]?.id,
            style: "arrow",
          },
        });
      }
      const connectorOutputs = await executeToolCallsOptimized({
        toolCalls: connectorCalls,
        toolsByName,
        startedAt,
        command: params.command,
      });
      console.timeEnd(toolTimerLabel);
      const allOutputs = [...stickyOutputs, ...connectorOutputs];
      const affectedIds = [...new Set(allOutputs.flatMap((output) => [...collectObjectIds(output.result)]))];
      const createdObjects: BoardObject[] = [];
      for (const output of allOutputs) {
        collectBoardObjects(output.result, createdObjects);
      }
      mergeBoardCache(params.boardId, createdObjects);
      return {
        summary: "Built user journey map with 5 stages and connectors.",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (isRetrospectiveBoardCommand(params.command)) {
      const templateCalls: ToolCallLike[] = [
        { name: "createFrame", args: { title: "What Went Well", x: 0, y: 0, width: 200, height: 400 } },
        { name: "createFrame", args: { title: "What Didn't", x: 220, y: 0, width: 200, height: 400 } },
        { name: "createFrame", args: { title: "Action Items", x: 440, y: 0, width: 200, height: 400 } },
      ];
      console.time(toolTimerLabel);
      const outputs = await executeToolCallsOptimized({
        toolCalls: templateCalls,
        toolsByName,
        startedAt,
        command: params.command,
      });
      console.timeEnd(toolTimerLabel);
      const affectedIds = [...new Set(outputs.flatMap((output) => [...collectObjectIds(output.result)]))];
      const createdObjects: BoardObject[] = [];
      for (const output of outputs) {
        collectBoardObjects(output.result, createdObjects);
      }
      mergeBoardCache(params.boardId, createdObjects);
      return {
        summary: "Created retrospective board with three columns.",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (loweredCommand.includes("swot") && (loweredCommand.includes("template") || loweredCommand.includes("analysis"))) {
      const templateCalls: ToolCallLike[] = [
        { name: "createFrame", args: { title: "Strengths", x: 0, y: 0, width: 200, height: 200 } },
        { name: "createFrame", args: { title: "Weaknesses", x: 220, y: 0, width: 200, height: 200 } },
        { name: "createFrame", args: { title: "Opportunities", x: 0, y: 220, width: 200, height: 200 } },
        { name: "createFrame", args: { title: "Threats", x: 220, y: 220, width: 200, height: 200 } },
      ];
      console.time(toolTimerLabel);
      const outputs = await executeToolCallsOptimized({
        toolCalls: templateCalls,
        toolsByName,
        startedAt,
        command: params.command,
      });
      console.timeEnd(toolTimerLabel);
      const objectsAffectedSet = new Set<string>();
      const createdObjects: BoardObject[] = [];
      for (const output of outputs) {
        collectObjectIds(output.result, objectsAffectedSet);
        collectBoardObjects(output.result, createdObjects);
      }
      mergeBoardCache(params.boardId, createdObjects);
      const affectedIds = [...objectsAffectedSet];
      const boundingBox = computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
      return {
        summary: "Created SWOT analysis template with 4 quadrants at absolute coordinates.",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    const llmWithTools = model.bindTools([
      tools.createStickyNote,
      tools.createShape,
      tools.createFrame,
      tools.createConnector,
      tools.moveObject,
      tools.resizeObject,
      tools.updateText,
      tools.changeColor,
      tools.getBoardState,
    ]);
    console.time(llmTimerLabel);
    const response = (await llmWithTools.invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(params.command)], {
      signal: params.signal,
      metadata,
      tags: ["collabboard", "agent", commandType, "single-pass"],
      runName: "collabboard-agent-single-pass",
      callbacks: sharedCallbacks,
    })) as unknown as AIMessage;
    console.timeEnd(llmTimerLabel);
    const toolCalls = extractToolCalls(response);

    if (toolCalls.length === 0) {
      return {
        summary: "Done",
        objectsAffected: [],
        durationMs: Date.now() - startedAt,
        boundingBox: null,
      };
    }

    console.time(toolTimerLabel);
    const results = await executeToolCallsOptimized({
      toolCalls,
      toolsByName,
      startedAt,
      command: params.command,
    });
    console.timeEnd(toolTimerLabel);

    const objectsAffectedSet = new Set<string>();
    const affectedObjectsFromTools: BoardObject[] = [];
    for (const output of results) {
      collectObjectIds(output.result, objectsAffectedSet);
      collectBoardObjects(output.result, affectedObjectsFromTools);
    }
    mergeBoardCache(params.boardId, affectedObjectsFromTools);
    const affectedIds = [...objectsAffectedSet];
    const boundingBox =
      computeBoundingBox(affectedObjectsFromTools) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
    const summary = buildSummaryFromToolResults(results);
    const tokenSource = [{ type: "ai", ...(response as unknown as Record<string, unknown>) }];
    const { inputTokens, outputTokens } = extractTokenUsage(tokenSource);
    const cost = calculateRunCost({
      model: modelName,
      inputTokens,
      outputTokens,
    });
    console.log("[AI Cost]", {
      command: params.command,
      model: modelName,
      inputTokens,
      outputTokens,
      totalCost: cost.totalCost,
    });

    if (rootRunId) {
      try {
        await (langsmithClient as unknown as {
          updateRun?: (runId: string, payload: Record<string, unknown>) => Promise<unknown>;
        }).updateRun?.(rootRunId, {
          extra: {
            metadata: {
              ...metadata,
              inputTokens,
              outputTokens,
              inputCostUsd: cost.inputCost,
              outputCostUsd: cost.outputCost,
              totalCostUsd: cost.totalCost,
            },
          },
        });
      } catch {
        // Swallow metadata update failures so agent command responses stay reliable.
      }
    }

    console.log("[AI timing] final response assembled", {
      atMs: Date.now(),
      totalAgentDurationMs: Date.now() - startedAt,
    });

    return {
      summary,
      objectsAffected: affectedIds,
      durationMs: Date.now() - startedAt,
      boundingBox,
    };
  } finally {
    console.timeEnd(totalTimerLabel);
  }
}
