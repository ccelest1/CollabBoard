import { ChatOpenAI } from "@langchain/openai";
import { Client as LangSmithClient } from "langsmith";
import { buildTools, calculateCenteredGridPositions, createBoardTools, type BoardMutationHandlers } from "@/lib/ai/tools";
import { calculateRunCost } from "@/lib/ai/costTracker";
import { HumanMessage, SystemMessage, ToolMessage, type AIMessage } from "@langchain/core/messages";
import type { BoardObject } from "@/lib/boards/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPersistedBoardSnapshot, savePersistedBoardSnapshot } from "@/lib/supabase/boardStateStore";
import { createBoardEventsChannel, sendBoardRealtimeEvent, subscribeChannel } from "@/lib/supabase/boardRealtime";
import { findEmptyPlacement } from "@/lib/ai/boardState";
import { recordChange } from "@/lib/supabase/versionHistory";
import { isInvalidInput } from "@/lib/ai/intentClassifier";
import { planCommand, resolveStepArgs } from "@/lib/ai/planner";

type CommandType = "creation" | "manipulation" | "layout" | "complex";
type AgentBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SYSTEM_PROMPT = `You are an AI assistant controlling a collaborative whiteboard called BEND.
Coordinate system: (0,0) is top-left, x increases right, y increases down.

CRITICAL EXECUTION RULES:
1. You operate in a verified loop. After each batch of tool calls completes, you are called again.
   Continue calling tools until ALL required objects are created or updated.
   Do not stop after 1-2 calls when more are required.

2. For these commands, use EXACT tool counts:
   - "SWOT analysis" -> EXACTLY 4 createFrame calls:
     Strengths (0,0,200,200), Weaknesses (220,0,200,200),
     Opportunities (0,220,200,200), Threats (220,220,200,200)
   - "2x3 grid for pros and cons" -> EXACTLY 6 createStickyNote calls:
     Pro 1 (0,0), Pro 2 (170,0), Con 1 (0,170), Con 2 (170,170), Pro 3 (340,0), Con 3 (340,170)
   - "user journey map with 5 stages" -> create 1 outer frame + 5 stage sticky notes
   - "retrospective board" -> EXACTLY 3 createFrame calls:
     What Went Well (0,0,250,500), What Didn't (270,0,250,500), Action Items (540,0,250,500)

3. Multi-step commands (create then modify):
   complete all creation first, then mutate using returned ids.
   Never claim you cannot find an object created in the same request.

4. getBoardState returns all objects including user-created objects.
   When asked to act on existing objects (move/recolor/resize), call getBoardState first.

5. Only call getBoardState for existing-object commands, not pure creation commands.

6. Placement rule for multi-object templates:
   call getBoardState first, find rightmost x, and start new template at maxX + 60.
   Never place a full template at 0,0 when content already exists.

7. For "resize frame to fit contents":
   1. Call getBoardState
   2. Get ALL objects that are not frames (ignore parentId entirely)
   3. Calculate bounding box with 40px padding on all sides
   4. Call moveObject to reposition the frame to minX-40, minY-40
   5. Call resizeObject to set width = maxX-minX+80, height = maxY-minY+80
   6. The frame should fully surround every non-frame object on the board

8. Keep responses concise and action-focused.`;

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
const langsmithClient = process.env.LANGSMITH_TRACING === "true" ? new LangSmithClient() : null;
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
  return shouldUseComplexModel(command) ? "gpt-4o" : "gpt-4o";
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

function sanitizeCommand(command: string) {
  return command.replace(/\s+/g, " ").trim();
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "Tool result could not be serialized" });
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
  const modelName = getModelName(command);
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

async function executeSingleTool(params: {
  call: ToolCallLike;
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
  startedAt: number;
  command: string;
  timeoutMs?: number;
}) {
  const tool = params.toolsByName[params.call.name];
  if (!tool) return null;
  if (params.call.name === "getBoardState") {
    console.warn("[getBoardState called] command:", params.command);
  }
  const toolStartedAt = Date.now();
  const timeoutMs =
    params.timeoutMs ?? (["resizeObject", "moveObject"].includes(params.call.name) ? 12000 : 8000);
  try {
    const result = await Promise.race([
      tool.invoke(params.call.args ?? {}),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool ${params.call.name} timed out`)), timeoutMs);
      }),
    ]);
    const toolEndedAt = Date.now();
    void toolEndedAt;
    return { call: params.call, result };
  } catch (error) {
    const toolEndedAt = Date.now();
    console.error("[AI timing] tool failed", {
      tool: params.call.name,
      atMs: toolEndedAt,
      durationMs: toolEndedAt - toolStartedAt,
      sinceAgentStartMs: toolEndedAt - params.startedAt,
      message: error instanceof Error ? error.message : "Unknown tool execution error",
    });
    return null;
  }
}

async function executeToolCallsOptimized(params: {
  toolCalls: ToolCallLike[];
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
  startedAt: number;
  command: string;
}) {
  const stateCalls = params.toolCalls.filter((call) => call.name === "getBoardState");
  const creationToolNames = new Set(["createStickyNote", "createShape", "createFrame"]);
  const creationCalls = params.toolCalls.filter((call) => creationToolNames.has(call.name));
  const mutationCalls = params.toolCalls.filter(
    (call) => call.name !== "getBoardState" && !creationToolNames.has(call.name),
  );
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
  }

  const creationOutputs = await Promise.all(
    creationCalls.map((call) =>
      executeSingleTool({
        call,
        toolsByName: params.toolsByName,
        startedAt: params.startedAt,
        command: params.command,
      }),
    ),
  );
  const creationResults = creationOutputs.filter((value): value is { call: ToolCallLike; result: unknown } => Boolean(value));
  outputs.push(...creationResults);

  const createdIds = creationResults.flatMap((output) => [...collectObjectIds(output.result)]);
  const lastCreatedId = createdIds.at(-1);
  const resolvedMutationCalls = mutationCalls.map((call) => {
    const args = { ...(call.args ?? {}) };
    if (typeof args.objectId !== "string" && lastCreatedId) {
      args.objectId = lastCreatedId;
    }
    return { ...call, args };
  });

  const mutationOutputs = await Promise.all(
    resolvedMutationCalls.map((call) =>
      executeSingleTool({
        call,
        toolsByName: params.toolsByName,
        startedAt: params.startedAt,
        command: params.command,
      }),
    ),
  );
  outputs.push(...mutationOutputs.filter((value): value is { call: ToolCallLike; result: unknown } => Boolean(value)));

  return outputs;
}

function buildConversationalSummary(
  toolName: string,
  count: number,
  details?: { color?: string; type?: string; label?: string },
): string {
  const color = details?.color ?? "";
  const type = details?.type ?? "item";
  const label = details?.label ?? "";
  const phrases: Record<string, (n: number) => string> = {
    createStickyNote: (n) =>
      n === 1
        ? `I added a${color ? ` ${color}` : ""} sticky note${label ? ` labeled "${label}"` : ""}`
        : `I created ${n}${color ? ` ${color}` : ""} sticky notes`,
    createFrame: (n) => (n === 1 ? `I set up a frame${label ? ` called "${label}"` : ""}` : `I built ${n} frames`),
    createShape: (n) => (n === 1 ? `I drew a${color ? ` ${color}` : ""} ${type}` : `I created ${n} ${type}s`),
    moveObject: (n) => `I moved ${n} object${n > 1 ? "s" : ""} to the right`,
    changeColor: (n) => `I updated the color on ${n} object${n > 1 ? "s" : ""}`,
    resizeObject: (n) => `I resized ${n} object${n > 1 ? "s" : ""}`,
    updateText: (n) => `I updated the text on ${n} object${n > 1 ? "s" : ""}`,
    getBoardState: () => "",
  };
  return phrases[toolName]?.(count) ?? "Done";
}

function buildGroupedToolSummary(results: Array<{ call: ToolCallLike; result: unknown }>) {
  const grouped = results.reduce(
    (acc, result) => {
      acc[result.call.name] = (acc[result.call.name] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const summary = Object.entries(grouped)
    .filter(([name]) => name !== "getBoardState")
    .map(([name, count]) => buildConversationalSummary(name, count))
    .filter(Boolean)
    .join(", ");
  return summary || "Done";
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
  return isSpaceEvenlyCommand(command) || /\b(arrange|align|layout)\b/.test(lowered);
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

function isMoveColorCommand(command: string): boolean {
  const lowered = command.toLowerCase();
  return (
    (lowered.includes("move") || lowered.includes("push") || lowered.includes("shift") || lowered.includes("send")) &&
    (lowered.includes("sticky") || lowered.includes("notes")) &&
    (lowered.includes("right") ||
      lowered.includes("left") ||
      lowered.includes("top") ||
      lowered.includes("bottom") ||
      lowered.includes("side"))
  );
}

function isResizeFrameFitContentsCommand(command: string) {
  const lowered = command.toLowerCase();
  return lowered.includes("resize") && lowered.includes("frame") && lowered.includes("fit");
}

function isArrangeStickyGridCommand(command: string) {
  const lowered = command.toLowerCase();
  return lowered.includes("arrange") && lowered.includes("grid");
}

function isArrangeGridCommand(command: string) {
  const lowered = command.toLowerCase();
  return (
    (lowered.includes("arrange") && (lowered.includes("grid") || lowered.includes("sticky"))) ||
    (lowered.includes("put") && lowered.includes("grid")) ||
    (lowered.includes("organize") && lowered.includes("sticky")) ||
    lowered.includes("arrange in a grid")
  );
}

function isProsConsGridCommand(command: string) {
  const lowered = command.toLowerCase();
  return includesAll(lowered, ["2x3", "grid", "sticky", "pros", "cons"]);
}

function isJourneyMapCommand(command: string) {
  if (isDeleteCommand(command)) return false;
  const lowered = command.toLowerCase();
  return (
    lowered.includes("journey map") ||
    lowered.includes("user journey") ||
    (lowered.includes("journey") && lowered.includes("stage")) ||
    (lowered.includes("user") && lowered.includes("stages")) ||
    lowered.includes("customer journey")
  );
}

function isRetrospectiveBoardCommand(command: string) {
  const lowered = command.toLowerCase();
  return lowered.includes("retrospective board");
}

function isSWOTCommand(command: string) {
  if (isDeleteCommand(command)) return false;
  const lowered = command.toLowerCase();
  return (
    lowered.includes("swot") ||
    (lowered.includes("strength") && lowered.includes("weakness")) ||
    lowered.includes("four quadrants") ||
    (lowered.includes("quadrant") && lowered.includes("analysis"))
  );
}

function isRetroCommand(command: string) {
  if (isDeleteCommand(command)) return false;
  const lowered = command.toLowerCase();
  return (
    lowered.includes("retrospective") ||
    lowered.includes("retro") ||
    lowered.includes("went well") ||
    lowered.includes("action items") ||
    (lowered.includes("what") && lowered.includes("didn't")) ||
    lowered.includes("sprint review")
  );
}

function isGridCommand(command: string) {
  if (isDeleteCommand(command)) return false;
  if (isArrangeGridCommand(command)) return false;
  const lowered = command.toLowerCase();
  return (
    lowered.includes("2x3") ||
    lowered.includes("3x2") ||
    lowered.includes("grid of sticky") ||
    (lowered.includes("pros") && lowered.includes("cons")) ||
    (lowered.includes("grid") && lowered.includes("notes"))
  );
}

function isBulkCreateCommand(cmd: string): {
  matched: boolean;
  count: number;
  objectType: "sticky" | "rectangle" | "circle" | "frame" | "connector" | "text" | "journeyMap" | "swot" | "retro";
  color: string | null;
  arrangement: "row" | "column" | "grid" | null;
} {
  const lowered = cmd.toLowerCase();
  const templatePattern =
    /(?:create|add|make|draw|generate|build|place|put|give me|show|produce)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+((?:user\s+)?journey\s+maps?|swot(?:\s+analyses?)?|retrospectives?)/i;
  const pattern =
    /(?:create|add|make|draw|generate|build|place|put|give me|show|produce)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(\w+)?\s*(sticky\s*notes?|stickies|rectangles?|squares?|circles?|ovals?|frames?|arrows?|connectors?|lines?|textboxes?|text\s*boxes?|shapes?)/i;
  const wordNumbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  const templateMatch = lowered.match(templatePattern);
  if (templateMatch) {
    const countRaw = (templateMatch[1] ?? "").toLowerCase();
    const count = wordNumbers[countRaw] ?? Number.parseInt(countRaw, 10) ?? 1;
    const typeWord = (templateMatch[2] ?? "").toLowerCase().trim();
    const templateTypeMap: Record<string, "journeyMap" | "swot" | "retro"> = {
      "journey maps": "journeyMap",
      "journey map": "journeyMap",
      "user journey maps": "journeyMap",
      "user journey map": "journeyMap",
      swot: "swot",
      "swot analysis": "swot",
      "swot analyses": "swot",
      retrospectives: "retro",
      retrospective: "retro",
    };
    const objectType = Object.entries(templateTypeMap).find(([key]) => typeWord.includes(key))?.[1] ?? "journeyMap";
    return { matched: true, count, objectType, color: null, arrangement: null };
  }

  const match = lowered.match(pattern);
  if (!match) {
    return { matched: false, count: 0, objectType: "sticky", color: null, arrangement: null };
  }

  const countRaw = (match[1] ?? "").toLowerCase();
  const count = wordNumbers[countRaw] ?? Number.parseInt(countRaw, 10) ?? 1;
  const colorWord = match[2] ?? null;
  const typeWord = (match[3] ?? "").toLowerCase().trim();

  const typeMap: Record<string, "sticky" | "rectangle" | "circle" | "frame" | "connector" | "text"> = {
    "sticky notes": "sticky",
    "sticky note": "sticky",
    stickies: "sticky",
    sticky: "sticky",
    rectangles: "rectangle",
    rectangle: "rectangle",
    squares: "rectangle",
    square: "rectangle",
    circles: "circle",
    circle: "circle",
    ovals: "circle",
    oval: "circle",
    frames: "frame",
    frame: "frame",
    arrows: "connector",
    arrow: "connector",
    connectors: "connector",
    connector: "connector",
    lines: "connector",
    line: "connector",
    textboxes: "text",
    "text boxes": "text",
    textbox: "text",
    "text box": "text",
    shapes: "rectangle",
    shape: "rectangle",
  };

  const objectType = Object.entries(typeMap).find(([key]) => typeWord.includes(key))?.[1] ?? "sticky";

  const colorMap: Record<string, string> = {
    pink: "#FBCFE8",
    yellow: "#FDE68A",
    blue: "#BFDBFE",
    green: "#BBF7D0",
    orange: "#FED7AA",
    red: "#FCA5A5",
    purple: "#DDD6FE",
    white: "#FFFFFF",
    black: "#000000",
    grey: "#E5E7EB",
    gray: "#E5E7EB",
  };

  const color = colorWord ? colorMap[colorWord.toLowerCase()] ?? null : null;
  const arrangement = lowered.includes("in a row") || lowered.includes("horizontally")
    ? "row"
    : lowered.includes("in a column") || lowered.includes("vertically")
      ? "column"
      : "grid";

  return { matched: true, count, objectType, color, arrangement };
}

function isDeleteCommand(cmd: string): boolean {
  const lowered = cmd.toLowerCase();
  const deleteVerbs = ["delete", "remove", "erase", "clear the board", "clear all", "get rid of", "destroy", "wipe"];
  return deleteVerbs.some((verb) => lowered.includes(verb));
}

function isSpaceEvenlyCommand(cmd: string): boolean {
  const lowered = cmd.toLowerCase();
  return (
    (lowered.includes("space") && lowered.includes("evenly")) ||
    lowered.includes("distribute") ||
    lowered.includes("spread out") ||
    (lowered.includes("even") && lowered.includes("spacing"))
  );
}

function isCreateThenModifyCommand(cmd: string): boolean {
  const lowered = cmd.toLowerCase();
  const bulk = isBulkCreateCommand(cmd);
  const referencesSticky = /\bsticky\b|\bstickies\b|\bnote\b/.test(lowered);
  return (
    (lowered.includes("and then") ||
      lowered.includes("then make") ||
      lowered.includes("then change") ||
      lowered.includes("and make") ||
      lowered.includes("and change")) &&
    (lowered.includes("create") || lowered.includes("add") || lowered.includes("make")) &&
    referencesSticky &&
    (!bulk.matched || bulk.count <= 1)
  );
}

async function executeCreateThenModify(params: {
  boardId: string;
  start: number;
  command: string;
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
}) {
  const splitPattern = /and then|then make|then change|and make|and change/;
  const lower = params.command.toLowerCase();
  const createPart = lower.split(splitPattern)[0] ?? lower;
  const modifyPart = lower.split(splitPattern)[1] ?? "";
  const colorMap: Record<string, string> = {
    red: "#FCA5A5",
    pink: "#FBCFE8",
    yellow: "#FDE68A",
    blue: "#BFDBFE",
    green: "#BBF7D0",
    orange: "#FED7AA",
    purple: "#DDD6FE",
    white: "#FFFFFF",
    black: "#000000",
  };
  const createColor = Object.entries(colorMap).find(([key]) => createPart.includes(key));
  const modifyColor = Object.entries(colorMap).find(([key]) => modifyPart.includes(key));

  const created = await params.toolsByName.createStickyNote.invoke({
    text: "Sticky",
    x: 0,
    y: 0,
    color: createColor?.[1] ?? "#FDE68A",
  });
  const createdObjects: BoardObject[] = [];
  collectBoardObjects(created, createdObjects);
  mergeBoardCache(params.boardId, createdObjects);

  await sleep(300);

  const createdId = [...collectObjectIds(created)][0];
  if (createdId && modifyColor) {
    const updated = await params.toolsByName.changeColor.invoke({
      objectId: createdId,
      color: modifyColor[1],
    });
    const updatedObjects: BoardObject[] = [];
    collectBoardObjects(updated, updatedObjects);
    mergeBoardCache(params.boardId, updatedObjects);
  }

  const finalColor = modifyColor?.[0] ?? createColor?.[0] ?? "default";
  return {
    summary: `I created a ${finalColor} sticky note`,
    objectsAffected: createdId ? [createdId] : [],
    durationMs: Date.now() - params.start,
    boundingBox: computeBoundingBox(createdObjects),
    objectsCreated: createdObjects,
  };
}

async function executeBulkCreate(params: {
  boardId: string;
  userId: string;
  start: number;
  command: string;
  handlers: BoardMutationHandlers;
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
}) {
  try {
    const { matched, count, objectType, color, arrangement } = isBulkCreateCommand(params.command);
    if (!matched || count <= 0) {
      return {
        summary: "Done",
        objectsAffected: [] as string[],
        durationMs: Date.now() - params.start,
        boundingBox: null,
        objectsCreated: [] as BoardObject[],
      };
    }
    if (objectType === "journeyMap") {
      const allCreated: BoardObject[] = [];
      const allAffected = new Set<string>();
      for (let i = 0; i < count; i += 1) {
        const existing = await getFreshBoardState({
          boardId: params.boardId,
          handlers: params.handlers,
          minExpected: allCreated.length,
        });
        const offsetX =
          existing.length > 0
            ? Math.max(...existing.map((object) => (object.x ?? 0) + (object.width ?? 200))) + 60
            : 0;
        const mapResult = await executeJourneyMapTemplate({
          boardId: params.boardId,
          userId: params.userId,
          start: Date.now(),
          offsetX,
          handlers: params.handlers,
          toolsByName: params.toolsByName,
        });
        mapResult.objectsAffected.forEach((id) => allAffected.add(id));
        allCreated.push(...(mapResult.objectsCreated ?? []));
        await sleep(400);
      }
      mergeBoardCache(params.boardId, allCreated);
      return {
        summary: `I built ${count} user journey maps`,
        objectsAffected: [...allAffected],
        durationMs: Date.now() - params.start,
        boundingBox: computeBoundingBox(allCreated) ?? (await getBoundingBoxForAffectedObjects(params.handlers, [...allAffected])),
        objectsCreated: allCreated,
      };
    }

    const persistedObjects = await params.handlers.getBoardObjects();
    const boardObjects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
    mergeBoardCache(params.boardId, boardObjects);
    const offsetX = boardObjects.length > 0 ? Math.max(...boardObjects.map((object) => (object.x ?? 0) + (object.width ?? 150))) + 60 : 0;
    const gap = 20;
    const width = objectType === "frame" ? 200 : 150;
    const height = objectType === "frame" ? 200 : 150;
    const cols =
      arrangement === "row"
        ? Math.max(count, 1)
        : arrangement === "column"
          ? 1
          : Math.ceil(Math.sqrt(Math.max(count, 1)));
    const objectsCreated: BoardObject[] = [];
    const affectedIds = new Set<string>();
    const defaultColor = color ?? "#FDE68A";
    const delayMs = objectType === "frame" ? 300 : objectType === "sticky" ? 250 : 150;
    for (let i = 0; i < count; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = offsetX + col * (width + gap);
      const y = row * (height + gap);
      try {
        let result: unknown = null;
        if (objectType === "sticky") {
          result = await params.toolsByName.createStickyNote.invoke({ text: "Sticky", x, y, color: defaultColor });
        } else if (objectType === "rectangle" || objectType === "circle") {
          result = await params.toolsByName.createShape.invoke({
            type: objectType,
            x,
            y,
            width,
            height,
            color: defaultColor,
          });
        } else if (objectType === "frame") {
          result = await params.toolsByName.createFrame.invoke({
            title: `Frame ${i + 1}`,
            x,
            y,
            width,
            height,
          });
        } else if (objectType === "connector") {
          console.warn("[BulkCreate] Arrow/connector requires source objects");
          continue;
        } else if (objectType === "text") {
          result = await params.toolsByName.createStickyNote.invoke({
            text: `Text ${i + 1}`,
            x,
            y,
            color: "#FFFFFF",
          });
        }
        if (result) {
          collectObjectIds(result, affectedIds);
          collectBoardObjects(result, objectsCreated);
        }
        await sleep(delayMs);
      } catch (err) {
        console.error(`[BulkCreate] Failed on item ${i + 1}:`, err);
      }
    }
    mergeBoardCache(params.boardId, objectsCreated);
    const labelMap: Record<string, string> = {
      sticky: "sticky notes",
      rectangle: "rectangles",
      circle: "circles",
      frame: "frames",
      connector: "connectors",
      text: "textboxes",
      journeyMap: "user journey maps",
      swot: "SWOT templates",
      retro: "retrospectives",
    };
    const typeLabel = labelMap[objectType] ?? "objects";
    return {
      summary:
        objectType === "sticky"
          ? `I created ${objectsCreated.length} sticky notes`
          : objectType === "rectangle" || objectType === "circle"
            ? `I drew ${objectsCreated.length} ${typeLabel}`
            : `I created ${objectsCreated.length} ${typeLabel}`,
      objectsAffected: [...affectedIds],
      durationMs: Date.now() - params.start,
      boundingBox:
        computeBoundingBox(objectsCreated) ?? (await getBoundingBoxForAffectedObjects(params.handlers, [...affectedIds])),
      objectsCreated,
    };
  } catch (err) {
    console.error("[BulkCreate] Failed:", err);
    return {
      summary: "I couldn't create those objects — please try again",
      objectsAffected: [] as string[],
      durationMs: Date.now() - params.start,
      boundingBox: null,
      objectsCreated: [] as BoardObject[],
    };
  }
}

function extractColorFromCommand(lowered: string): string | null {
  const colors = ["pink", "yellow", "blue", "green", "orange", "red", "purple", "white", "black"];
  return colors.find((color) => lowered.includes(color)) ?? null;
}

function matchesColor(objectColor: string | undefined, colorName: string): boolean {
  const colorValues: Record<string, string[]> = {
    pink: ["fbcfe8", "f4a0c0", "ec4899", "pink"],
    yellow: ["fde68a", "f9c74f", "yellow"],
    blue: ["bfdbfe", "74b3f0", "3b82f6", "blue"],
    green: ["bbf7d0", "57cc99", "22c55e", "green"],
    orange: ["fed7aa", "f9844a", "f59e0b", "orange"],
    red: ["fca5a5", "ef4444", "red"],
    purple: ["ddd6fe", "8b5cf6", "a855f7", "purple"],
    white: ["ffffff", "white"],
    black: ["000000", "0f172a", "black"],
  };
  const normalized = String(objectColor ?? "").toLowerCase();
  const tokens = colorValues[colorName] ?? [colorName];
  return tokens.some((token) => normalized.includes(token));
}

function isStickyObject(object: BoardObject) {
  const type = String(object.type ?? "").toLowerCase();
  return type === "sticky" || type === "stickynote";
}

function getObjectLabel(object: BoardObject) {
  return `${String(object.type)}:${String(object.text ?? object.id.slice(0, 8))}`;
}

function resolveByType(lowered: string, objects: BoardObject[]): BoardObject[] {
  const typeMap: Record<string, string[]> = {
    sticky: ["sticky", "stickynote", "note", "stickies", "sticky notes", "post-it", "postit"],
    frame: ["frame", "frames", "container", "section"],
    rectangle: ["rectangle", "rectangles", "square", "squares", "box", "boxes", "shape", "shapes"],
    circle: ["circle", "circles", "oval", "ovals"],
    connector: ["arrow", "arrows", "connector", "connectors", "line", "lines"],
    text: ["text", "textbox", "text box", "label"],
  };

  for (const [normalizedType, keywords] of Object.entries(typeMap)) {
    if (!keywords.some((keyword) => lowered.includes(keyword))) continue;
    return objects.filter((object) => {
      const objectType = String(object.type ?? "").toLowerCase();
      return (
        objectType === normalizedType ||
        (objectType === "stickynote" && normalizedType === "sticky") ||
        (objectType === "shape" && normalizedType === "rectangle")
      );
    });
  }
  return [];
}

function resolveByTemplate(lowered: string, objects: BoardObject[]): BoardObject[] {
  if (lowered.includes("swot") || (lowered.includes("strength") && lowered.includes("weakness"))) {
    return objects.filter((object) =>
      ["strengths", "weaknesses", "opportunities", "threats"].some((token) =>
        String(object.text ?? "").toLowerCase().includes(token),
      ),
    );
  }

  if (
    lowered.includes("retro") ||
    lowered.includes("retrospective") ||
    lowered.includes("went well") ||
    lowered.includes("action items")
  ) {
    return objects.filter((object) =>
      ["went well", "didn't", "action items", "what can"].some((token) =>
        String(object.text ?? "").toLowerCase().includes(token),
      ),
    );
  }

  if (
    lowered.includes("journey") ||
    lowered.includes("journey map") ||
    lowered.includes("user journey") ||
    lowered.includes("customer journey")
  ) {
    const byTitle = objects.filter((object) => {
      const label = String(object.text ?? "").toLowerCase();
      return label.includes("journey") || label.includes("stage");
    });
    return byTitle.length > 0 ? byTitle : objects.filter((object) => isStickyObject(object));
  }

  if (
    (lowered.includes("grid") || lowered.includes("pros") || lowered.includes("cons")) &&
    (lowered.includes("delete") || lowered.includes("remove") || lowered.includes("erase"))
  ) {
    return objects.filter((object) => {
      const label = String(object.text ?? "").toLowerCase();
      return label.includes("pro") || label.includes("con");
    });
  }

  return [];
}

function resolveByColor(lowered: string, objects: BoardObject[]): BoardObject[] {
  const colorMap: Record<string, string[]> = {
    yellow: ["#fde68a", "#f9c74f", "yellow"],
    pink: ["#fbcfe8", "#f4a0c0", "pink"],
    blue: ["#bfdbfe", "#74b3f0", "blue"],
    green: ["#bbf7d0", "#57cc99", "green"],
    orange: ["#fed7aa", "#f9844a", "orange"],
    red: ["#fca5a5", "red"],
    purple: ["#ddd6fe", "purple"],
  };

  for (const [colorName, values] of Object.entries(colorMap)) {
    if (!lowered.includes(colorName)) continue;
    return objects.filter((object) => {
      const normalizedColor = String(object.color ?? "").toLowerCase();
      return values.some((value) => normalizedColor.includes(value.toLowerCase()));
    });
  }
  return [];
}

function resolveDeleteTargets(
  command: string,
  objects: BoardObject[],
  sessionCreatedIds?: string[],
): BoardObject[] {
  const lowered = command.toLowerCase();
  const hasTypeKeyword =
    /(sticky|stickynote|note|stickies|post-it|postit|frame|frames|container|section|rectangle|rectangles|square|squares|box|boxes|shape|shapes|circle|circles|oval|ovals|arrow|arrows|connector|connectors|line|lines|text|textbox|text box|label)/.test(
      lowered,
    );
  const hasTemplateKeyword =
    lowered.includes("swot") ||
    lowered.includes("strength") ||
    lowered.includes("weakness") ||
    lowered.includes("retro") ||
    lowered.includes("retrospective") ||
    lowered.includes("journey") ||
    lowered.includes("journey map") ||
    lowered.includes("customer journey") ||
    lowered.includes("went well") ||
    lowered.includes("action items");
  const hasColorKeyword =
    /(yellow|pink|blue|green|orange|red|purple|white|black)/.test(lowered);

  if (
    lowered.includes("everything") ||
    lowered.includes("clear the board") ||
    lowered.includes("wipe") ||
    lowered.includes("the board")
  ) {
    return objects;
  }

  if (
    (lowered.includes("delete all") || lowered.includes("remove all") || lowered.includes("erase all") || lowered.includes("clear all")) &&
    !hasTypeKeyword &&
    !hasTemplateKeyword &&
    !hasColorKeyword
  ) {
    return objects;
  }

  if (
    (lowered.includes("those") || lowered.includes("them") || lowered.includes("these") || lowered.includes("this")) &&
    !hasTypeKeyword &&
    !hasTemplateKeyword &&
    !hasColorKeyword
  ) {
    if (sessionCreatedIds && sessionCreatedIds.length > 0) {
      const idSet = new Set(sessionCreatedIds);
      const sessionTargets = objects.filter((o) => idSet.has(o.id));
      if (sessionTargets.length > 0) {
        return sessionTargets;
      }
    }
    return objects;
  }

  const typeTargets = resolveByType(lowered, objects);
  const colorTargets = resolveByColor(lowered, objects);
  if (typeTargets.length > 0 && colorTargets.length > 0) {
    const colorIds = new Set(colorTargets.map((object) => object.id));
    return typeTargets.filter((object) => colorIds.has(object.id));
  }
  if (typeTargets.length > 0) return typeTargets;

  const templateTargets = resolveByTemplate(lowered, objects);
  if (templateTargets.length > 0) return templateTargets;

  if (colorTargets.length > 0) return colorTargets;

  if (lowered.includes("last") || lowered.includes("latest") || lowered.includes("recent")) {
    const latest = objects[objects.length - 1];
    return latest ? [latest] : [];
  }

  if (lowered.includes("that")) {
    const sorted = [...objects].sort((a, b) => Number(b.createdAt ?? b.updatedAt ?? 0) - Number(a.createdAt ?? a.updatedAt ?? 0));
    const mostRecent = sorted[0];
    return mostRecent ? [mostRecent] : [];
  }

  console.warn("[delete] no targets matched for command:", command);
  return [];
}

export async function getFreshBoardState(params: {
  boardId: string;
  handlers: BoardMutationHandlers;
  minExpected?: number;
}): Promise<BoardObject[]> {
  const MAX_RETRIES = 4;
  const RETRY_DELAY = 400;
  const minExpected = params.minExpected ?? 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const persistedObjects = await params.handlers.getBoardObjects();
    const objects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
    mergeBoardCache(params.boardId, objects);

    if (objects.length > minExpected) return objects;
    if (attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAY);
    }
  }

  const persistedObjects = await params.handlers.getBoardObjects();
  const objects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
  mergeBoardCache(params.boardId, objects);
  return objects;
}

async function executeJourneyMapTemplate(params: {
  boardId: string;
  userId: string;
  start: number;
  offsetX?: number;
  handlers: BoardMutationHandlers;
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
}) {
  void params.userId;
  const existing =
    params.offsetX !== undefined ? [] : await getFreshBoardState({ boardId: params.boardId, handlers: params.handlers });
  const startX =
    params.offsetX ??
    (existing.length > 0 ? Math.max(...existing.map((object) => (object.x ?? 0) + (object.width ?? 200))) + 60 : 0);
  const objectsCreated: BoardObject[] = [];
  const affectedIds = new Set<string>();

  const container = await params.toolsByName.createFrame.invoke({
    title: "User Journey Map",
    x: startX,
    y: 0,
    width: 920,
    height: 220,
  });
  collectObjectIds(container, affectedIds);
  collectBoardObjects(container, objectsCreated);
  await sleep(300);

  for (let i = 1; i <= 5; i += 1) {
    const result = await params.toolsByName.createStickyNote.invoke({
      text: `Stage ${i}`,
      x: startX + 20 + (i - 1) * 178,
      y: 40,
      color: "#BFDBFE",
    });
    collectObjectIds(result, affectedIds);
    collectBoardObjects(result, objectsCreated);
    await sleep(300);
  }

  mergeBoardCache(params.boardId, objectsCreated);
  return {
    summary: "I created a user journey map with five stages",
    objectsAffected: [...affectedIds],
    durationMs: Date.now() - params.start,
    boundingBox: computeBoundingBox(objectsCreated) ?? (await getBoundingBoxForAffectedObjects(params.handlers, [...affectedIds])),
    objectsCreated,
  };
}

async function executeDelete(params: {
  boardId: string;
  start: number;
  command: string;
  sessionCreatedIds?: string[];
  handlers: BoardMutationHandlers;
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
}) {
  let objects = await getFreshBoardState({ boardId: params.boardId, handlers: params.handlers });

  if (objects.length === 0) {
    const cached = readBoardCache(params.boardId);
    if (cached.length > 0) {
      objects = cached;
    } else {
      await sleep(600);
      objects = await getFreshBoardState({ boardId: params.boardId, handlers: params.handlers });
    }
  }

  if (objects.length === 0) {
    return {
      summary: "The board is already empty",
      objectsAffected: [],
      durationMs: Date.now() - params.start,
      boundingBox: null,
      objectsCreated: [],
    };
  }

  const targets = resolveDeleteTargets(params.command, objects, params.sessionCreatedIds);

  if (targets.length === 0) {
    console.warn("[executeDelete] No targets found for command:", params.command);
    return {
      summary: "No matching objects found on the board",
      objectsAffected: [],
      durationMs: Date.now() - params.start,
      boundingBox: null,
      objectsCreated: [],
    };
  }

  const deletedIds: string[] = [];
  await sleep(200);
  for (const object of targets) {
    await params.toolsByName.deleteObject.invoke({ objectId: object.id });
    deletedIds.push(object.id);
    await sleep(150);
  }

  const boardCache = boardObjectCache.get(params.boardId);
  if (boardCache) {
    for (const id of deletedIds) {
      boardCache.delete(id);
    }
  }

  const label = targets.length === 1 ? "1 object" : `${targets.length} objects`;
  return {
    summary: `I deleted ${label}`,
    objectsAffected: deletedIds,
    durationMs: Date.now() - params.start,
    boundingBox: null,
    objectsCreated: [],
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
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

async function resolvePlacementOrigin(params: {
  supabase?: SupabaseClient;
  handlers: BoardMutationHandlers;
  boardId: string;
  requiredWidth: number;
  requiredHeight: number;
  padding?: number;
}) {
  if (params.supabase) {
    return findEmptyPlacement({
      supabase: params.supabase,
      boardId: params.boardId,
      requiredWidth: params.requiredWidth,
      requiredHeight: params.requiredHeight,
      padding: params.padding,
    });
  }
  const objects = await params.handlers.getBoardObjects();
  if (objects.length === 0) return { x: 0, y: 0 };
  const box = computeBoundingBox(objects);
  if (!box) return { x: 0, y: 0 };
  const padding = params.padding ?? 40;
  if (box.width < 1200) {
    return { x: box.x + box.width + padding, y: box.y };
  }
  return { x: box.x, y: box.y + box.height + padding };
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
  userName?: string;
  targetObjectId?: string;
  viewportCenter?: { x: number; y: number };
  signal?: AbortSignal;
}): Promise<{
  summary: string;
  objectsAffected: string[];
  durationMs: number;
  boundingBox: AgentBoundingBox | null;
  objectsCreated?: BoardObject[];
}> {
  const startedAt = Date.now();
  const command = sanitizeCommand(params.command);

  if (isInvalidInput(command)) {
    return {
      summary: "Please enter a valid board command",
      objectsAffected: [],
      durationMs: Date.now() - startedAt,
      boundingBox: null,
      objectsCreated: [],
    };
  }

  const registryEntry = handlerRegistry.get(registryKey(params.boardId, params.userId));
  if (!registryEntry) {
    throw new Error(`No handlers registered for board ${params.boardId}`);
  }
  const { handlers, supabase } = registryEntry;

  const tools = supabase
    ? buildTools({ boardId: params.boardId, userId: params.userId, supabase, handlers })
    : createBoardTools(handlers, { boardId: params.boardId, userId: params.userId });

  const toolsByName: Record<string, { invoke: (input: any) => Promise<any> }> = {
    createStickyNote: tools.createStickyNote,
    createShape: tools.createShape,
    createFrame: tools.createFrame,
    createConnector: tools.createConnector,
    moveObject: tools.moveObject,
    resizeObject: tools.resizeObject,
    updateText: tools.updateText,
    changeColor: tools.changeColor,
    deleteObject: tools.deleteObject,
    getBoardState: tools.getBoardState,
  };

  // Get board state for planning context
  const boardObjects = await getFreshBoardState({
    boardId: params.boardId,
    handlers,
  });
  mergeBoardCache(params.boardId, boardObjects);
  const boardStateStr = JSON.stringify(
    boardObjects.slice(0, 50).map((o) => ({
      id: o.id,
      type: o.type,
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height,
      color: o.color,
      text: o.text,
    })),
  );

  // Determine model
  const modelName = shouldUseComplexModel(command) ? "gpt-4o" : "gpt-4o";

  // Get plan from LLM
  const plan = await planCommand({
    command,
    boardState: boardStateStr,
    modelName,
    viewportCenter: params.viewportCenter,
  });

  // Execute plan steps in order
  const stepResults: Record<number, unknown> = {};
  const allObjectsCreated: BoardObject[] = [];
  const allObjectsAffected = new Set<string>();
  const originX = Math.round(params.viewportCenter?.x ?? 0);
  const originY = Math.round(params.viewportCenter?.y ?? 0);
  const fillDefaultArgs = (tool: string, args: Record<string, unknown>, index: number) => {
    const next = { ...args };
    if (tool === "createStickyNote") {
      const text = typeof next.text === "string" && next.text.trim() ? next.text : "Sticky Note";
      const x = typeof next.x === "number" ? next.x : originX + index * (150 + 20);
      const y = typeof next.y === "number" ? next.y : originY;
      const color = typeof next.color === "string" ? next.color : "#fde68a";
      return { ...next, text, x, y, color };
    }
    if (tool === "createShape") {
      const type = next.type === "circle" ? "circle" : "rectangle";
      const width = typeof next.width === "number" ? next.width : type === "circle" ? 100 : 150;
      const height = typeof next.height === "number" ? next.height : type === "circle" ? 100 : 100;
      const x = typeof next.x === "number" ? next.x : originX + index * (width + 20);
      const y = typeof next.y === "number" ? next.y : originY;
      const color =
        typeof next.color === "string" ? next.color : type === "circle" ? "#a855f7" : "#3b82f6";
      return { ...next, type, width, height, x, y, color };
    }
    if (tool === "createFrame") {
      const title = typeof next.title === "string" && next.title.trim() ? next.title : `Frame ${index + 1}`;
      const width = typeof next.width === "number" ? next.width : 200;
      const height = typeof next.height === "number" ? next.height : 200;
      const x = typeof next.x === "number" ? next.x : originX + index * (width + 20);
      const y = typeof next.y === "number" ? next.y : originY;
      return { ...next, title, width, height, x, y };
    }
    if (tool === "createConnector") {
      const style = next.style === "simple" ? "simple" : "arrow";
      return { ...next, style };
    }
    return next;
  };
  const latestCreatedId = () => {
    for (const id of Object.keys(stepResults).map(Number).sort((a, b) => b - a)) {
      const maybeId = (stepResults[id] as { id?: unknown } | undefined)?.id;
      if (typeof maybeId === "string") return maybeId;
    }
    return undefined;
  };
  const patchMissingObjectRefs = (step: { dependsOn: number[] }, args: Record<string, unknown>) => {
    const next = { ...args };
    const fallbackId =
      step.dependsOn.map((id) => (stepResults[id] as { id?: unknown } | undefined)?.id).find((id) => typeof id === "string") ??
      latestCreatedId();
    if (
      typeof fallbackId === "string" &&
      (next.objectId === undefined || next.objectId === null || next.objectId === "")
    ) {
      next.objectId = fallbackId;
    }
    return next;
  };

  for (const step of plan.steps) {
    try {
      // Resolve $step_N references in args
      const withDefaults = fillDefaultArgs(step.tool, step.args, step.id);
      const resolvedArgs = patchMissingObjectRefs(step, resolveStepArgs(withDefaults, stepResults));
      void resolvedArgs;

      const tool = toolsByName[step.tool];
      if (!tool) {
        console.warn(`[executor] unknown tool: ${step.tool}`);
        continue;
      }

      const result = await Promise.race([
        tool.invoke(resolvedArgs),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool ${step.tool} timed out`)), 10000),
        ),
      ]);

      stepResults[step.id] = result;

      // Collect created objects
      const created: BoardObject[] = [];
      collectBoardObjects(result, created);
      if (["createStickyNote", "createShape", "createFrame", "createConnector"].includes(step.tool)) {
        allObjectsCreated.push(...created);
      }

      // Collect affected IDs
      collectObjectIds(result, allObjectsAffected);

      await sleep(150);
    } catch (err) {
      console.error(`[executor] step ${step.id} failed:`, err);
    }
  }

  mergeBoardCache(params.boardId, allObjectsCreated);

  const affectedIds = [...allObjectsAffected];
  const boundingBox =
    computeBoundingBox(allObjectsCreated) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
  const finalBoundingBox = boundingBox ?? (
    allObjectsCreated.length > 0
      ? computeBoundingBox(allObjectsCreated)
      : null
  );

  // Record version history
  if (supabase) {
    try {
      const { loadPersistedBoardSnapshot } = await import("@/lib/supabase/boardStateStore");
      const { recordChange } = await import("@/lib/supabase/versionHistory");
      const snapshot = await loadPersistedBoardSnapshot(supabase, params.boardId);
      await recordChange(
        {
          boardId: params.boardId,
          userId: params.userId,
          userName: params.userName || "User",
          action: `AI: ${plan.intent}`,
          objectIds: affectedIds,
          boardSnapshot: snapshot,
        },
        supabase,
      );
    } catch (err) {
      console.warn("[executor] version history failed:", err);
    }
  }

  return {
    summary: "I " + plan.intent.charAt(0).toLowerCase() + plan.intent.slice(1),
    objectsAffected: affectedIds,
    durationMs: Date.now() - startedAt,
    boundingBox: finalBoundingBox,
    objectsCreated: allObjectsCreated,
  };
}
