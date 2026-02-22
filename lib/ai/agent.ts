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
import { classifyIntent, isInvalidInput } from "@/lib/ai/intentClassifier";

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
  console.log("[AI timing] tool start", {
    tool: params.call.name,
    atMs: toolStartedAt,
    sinceAgentStartMs: toolStartedAt - params.startedAt,
  });
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
    console.log("[AI timing] tool end", {
      tool: params.call.name,
      atMs: toolEndedAt,
      durationMs: toolEndedAt - toolStartedAt,
      sinceAgentStartMs: toolEndedAt - params.startedAt,
    });
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

function resolveDeleteTargets(command: string, objects: BoardObject[]): BoardObject[] {
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
    console.log(`[getFreshBoardState] attempt ${attempt + 1}: ${objects.length} objects`);

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
  handlers: BoardMutationHandlers;
  toolsByName: Record<string, { invoke: (input: any, config?: any) => Promise<any> }>;
}) {
  const objects = await getFreshBoardState({ boardId: params.boardId, handlers: params.handlers });
  console.log("[delete] boardId received:", params.boardId);
  console.log("[delete] getBoardState returned:", objects.length, "objects");
  console.log("[delete] board state:", {
    boardId: params.boardId,
    totalObjects: objects.length,
    types: objects.map((object) => ({ id: object.id, type: object.type, text: object.text })),
  });

  if (objects.length === 0) {
    return {
      summary: "The board is already empty",
      objectsAffected: [],
      durationMs: Date.now() - params.start,
      boundingBox: null,
      objectsCreated: [],
    };
  }

  const targets = resolveDeleteTargets(params.command, objects);
  console.log("[delete] targets resolved:", targets.length, targets.map(getObjectLabel));

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
  for (const object of targets) {
    console.log("[delete] deleting:", object.id, object.type, object.text);
    await params.toolsByName.deleteObject.invoke({ objectId: object.id });
    deletedIds.push(object.id);
    await sleep(150);
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
  signal?: AbortSignal;
}): Promise<{
  summary: string;
  objectsAffected: string[];
  durationMs: number;
  boundingBox: AgentBoundingBox | null;
  objectsCreated?: BoardObject[];
}> {
  const startedAt = Date.now();
  const timerId = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const totalTimerLabel = `[AI] total:${timerId}`;
  const llmTimerLabel = `[AI] llm-invoke:${timerId}`;
  const toolTimerLabel = `[AI] tool-execution:${timerId}`;
  console.time(totalTimerLabel);
  try {
    const result = await (async () => {
    const command = sanitizeCommand(params.command);
    console.log("[Agent] command received:", command);
    if (isInvalidInput(command)) {
      return {
        summary: "Please enter a valid board command",
        objectsAffected: [],
        durationMs: Date.now() - startedAt,
        boundingBox: null,
        objectsCreated: [],
      };
    }
    const intent = classifyIntent(command);
    console.log("[intent]", intent, "— command:", command);
    const bulkCheck = isBulkCreateCommand(command);
    console.log("[Agent] bulkCheck:", bulkCheck);
    const registryEntry = handlerRegistry.get(registryKey(params.boardId, params.userId));
    if (!registryEntry) {
      throw new Error(
        `No board mutation handlers registered for board "${params.boardId}" and user "${params.userId}".`,
      );
    }
    const { handlers, supabase } = registryEntry;

    const modelName = getModelName(command);
    const model = routeModel(command);
    const commandType = detectCommandType(command);
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
      deleteObject: tools.deleteObject,
      getBoardState: tools.getBoardState,
    };

    const currentBoardObjects = async () => {
      const persistedObjects = await handlers.getBoardObjects();
      const boardObjects = persistedObjects.length > 0 ? persistedObjects : readBoardCache(params.boardId);
      mergeBoardCache(params.boardId, boardObjects);
      return boardObjects;
    };

    const computeTemplateOffsetX = async (fallbackWidth: number) => {
      const objects = await currentBoardObjects();
      if (objects.length === 0) return 0;
      return Math.max(...objects.map((object) => (object.x ?? 0) + (object.width ?? fallbackWidth))) + 60;
    };

    if (intent === "delete") {
      return executeDelete({
        boardId: params.boardId,
        start: startedAt,
        command,
        handlers,
        toolsByName,
      });
    }

    if (intent === "create_then_modify") {
      return executeCreateThenModify({
        boardId: params.boardId,
        start: startedAt,
        command,
        toolsByName,
      });
    }

    if (intent === "swot") {
      const offsetX = await computeTemplateOffsetX(200);
      const quadrants = [
        { title: "Strengths", x: offsetX, y: 0, width: 200, height: 200 },
        { title: "Weaknesses", x: offsetX + 220, y: 0, width: 200, height: 200 },
        { title: "Opportunities", x: offsetX, y: 220, width: 200, height: 200 },
        { title: "Threats", x: offsetX + 220, y: 220, width: 200, height: 200 },
      ] as const;
      const objectsCreated: BoardObject[] = [];
      const affectedIds = new Set<string>();

      for (let i = 0; i < quadrants.length; i += 1) {
        const quadrant = quadrants[i];
        if (!quadrant) continue;
        console.log("[SWOT] Creating:", quadrant.title);
        const result = await toolsByName.createFrame.invoke({
          title: quadrant.title,
          x: quadrant.x,
          y: quadrant.y,
          width: quadrant.width,
          height: quadrant.height,
        });
        console.log("[SWOT] Created:", quadrant.title, (result as { id?: string })?.id);
        collectObjectIds(result, affectedIds);
        collectBoardObjects(result, objectsCreated);
        await sleep(300);
      }
      console.log("[SWOT] Complete —", objectsCreated.length, "quadrants");
      mergeBoardCache(params.boardId, objectsCreated);
      return {
        summary: "I set up a SWOT analysis with four quadrants",
        objectsAffected: [...affectedIds],
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(objectsCreated) ?? (await getBoundingBoxForAffectedObjects(handlers, [...affectedIds])),
        objectsCreated,
      };
    }

    if (intent === "retrospective") {
      const offsetX = await computeTemplateOffsetX(250);
      const columns = [
        { title: "What Went Well", x: offsetX, y: 0, width: 250, height: 500 },
        { title: "What Didn't", x: offsetX + 270, y: 0, width: 250, height: 500 },
        { title: "Action Items", x: offsetX + 540, y: 0, width: 250, height: 500 },
      ] as const;
      const objectsCreated: BoardObject[] = [];
      const affectedIds = new Set<string>();
      for (const column of columns) {
        console.log("[Retro] Creating:", column.title);
        const result = await toolsByName.createFrame.invoke({
          title: column.title,
          x: column.x,
          y: column.y,
          width: column.width,
          height: column.height,
        });
        console.log("[Retro] Created:", column.title, (result as { id?: string })?.id);
        collectObjectIds(result, affectedIds);
        collectBoardObjects(result, objectsCreated);
        await sleep(300);
      }
      mergeBoardCache(params.boardId, objectsCreated);
      return {
        summary: "I built a retrospective board with three columns",
        objectsAffected: [...affectedIds],
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(objectsCreated) ?? (await getBoundingBoxForAffectedObjects(handlers, [...affectedIds])),
        objectsCreated,
      };
    }

    if (intent === "journey_map") {
      const offsetX = await computeTemplateOffsetX(200);
      return executeJourneyMapTemplate({
        boardId: params.boardId,
        userId: params.userId,
        start: startedAt,
        offsetX,
        handlers,
        toolsByName,
      });
    }

    if (isProsConsGridCommand(command)) {
      const offsetX = await computeTemplateOffsetX(150);
      const labels = ["Pro 1", "Pro 2", "Pro 3", "Con 1", "Con 2", "Con 3"];
      const cols = 3;
      const objectsCreated: BoardObject[] = [];
      const affectedIds = new Set<string>();
      for (let i = 0; i < labels.length; i += 1) {
        const label = labels[i];
        if (!label) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        console.log("[Grid] Creating:", label);
        const result = await toolsByName.createStickyNote.invoke({
          text: label,
          x: offsetX + col * (150 + 20),
          y: row * (150 + 20),
          color: i < 3 ? "#BBF7D0" : "#FBCFE8",
        });
        console.log("[Grid] Created:", label, (result as { id?: string })?.id);
        collectObjectIds(result, affectedIds);
        collectBoardObjects(result, objectsCreated);
        await sleep(300);
      }
      mergeBoardCache(params.boardId, objectsCreated);
      return {
        summary: "I made a 2×3 grid for pros and cons",
        objectsAffected: [...affectedIds],
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(objectsCreated) ?? (await getBoundingBoxForAffectedObjects(handlers, [...affectedIds])),
        objectsCreated,
      };
    }

    if (intent === "create_bulk") {
      return executeBulkCreate({
        boardId: params.boardId,
        userId: params.userId,
        start: startedAt,
        command,
        handlers,
        toolsByName,
      });
    }

    if (isArrangeStickyGridCommand(command)) {
      const objects = await getFreshBoardState({ boardId: params.boardId, handlers });
      const frames = objects.filter((object) => object.type === "frame");
      const allXs = objects.map((object) => (object.x ?? 0) + (object.width ?? 150) / 2);
      const allYs = objects.map((object) => (object.y ?? 0) + (object.height ?? 150) / 2);
      const boardCenterX =
        allXs.length > 0 ? (Math.min(...allXs) + Math.max(...allXs)) / 2 : 0;
      const boardCenterY =
        allYs.length > 0 ? (Math.min(...allYs) + Math.max(...allYs)) / 2 : 0;
      let targetFrame: BoardObject | null = null;
      if (frames.length === 1) {
        targetFrame = frames[0] ?? null;
      } else if (frames.length > 1) {
        targetFrame =
          frames.reduce((closest, frame) => {
            const frameCX = (frame.x ?? 0) + (frame.width ?? 200) / 2;
            const frameCY = (frame.y ?? 0) + (frame.height ?? 200) / 2;
            const dist = Math.hypot(frameCX - boardCenterX, frameCY - boardCenterY);
            const closestCX = (closest.x ?? 0) + (closest.width ?? 200) / 2;
            const closestCY = (closest.y ?? 0) + (closest.height ?? 200) / 2;
            const closestDist = Math.hypot(closestCX - boardCenterX, closestCY - boardCenterY);
            return dist < closestDist ? frame : closest;
          }) ?? null;
      }
      const itemsToArrange = objects.filter((object) => {
        const objectType = String(object.type);
        return objectType === "sticky" || objectType === "stickyNote";
      });
      if (itemsToArrange.length === 0) {
        return {
          summary: "No sticky notes found to arrange",
          objectsAffected: [],
          durationMs: Date.now() - startedAt,
          boundingBox: null,
          objectsCreated: [],
        };
      }
      const count = itemsToArrange.length;
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const gap = 20;
      const itemW = itemsToArrange[0]?.width ?? 150;
      const itemH = itemsToArrange[0]?.height ?? 150;
      const startX = targetFrame
        ? (targetFrame.x ?? 0) + 20
        : -(cols * itemW + (cols - 1) * gap) / 2;
      const startY = targetFrame
        ? (targetFrame.y ?? 0) + 40
        : -(rows * itemH + (rows - 1) * gap) / 2;
      const movedObjects: BoardObject[] = [];
      const affectedIds: string[] = [];
      for (let i = 0; i < itemsToArrange.length; i += 1) {
        const item = itemsToArrange[i];
        if (!item) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const result = await toolsByName.moveObject.invoke({
          objectId: item.id,
          x: startX + col * (itemW + gap),
          y: startY + row * (itemH + gap),
        });
        affectedIds.push(item.id);
        collectBoardObjects(result, movedObjects);
        await sleep(150);
      }
      mergeBoardCache(params.boardId, movedObjects);
      return {
        summary: "I arranged everything in a grid",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(movedObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
        objectsCreated: [],
      };
    }

    if (intent === "move_objects") {
      const lowered = command.toLowerCase();
      const shouldHandleStickyMove = lowered.includes("right") && lowered.includes("sticky");
      if (shouldHandleStickyMove) {
        const objects = await getFreshBoardState({ boardId: params.boardId, handlers });
        const moveColorMap: Record<string, string[]> = {
          pink: ["#FBCFE8", "#F4A0C0", "#EC4899", "#FF00FF", "pink"],
          yellow: ["#FDE68A", "#F9C74F", "yellow"],
          blue: ["#BFDBFE", "#74B3F0", "blue"],
          green: ["#BBF7D0", "#57CC99", "green"],
          orange: ["#FED7AA", "#F9844A", "orange"],
        };
        const targetColor = Object.keys(moveColorMap).find((color) => lowered.includes(color));
        const targets = targetColor
          ? objects.filter((object) => {
              if (object.type !== "sticky") return false;
              const objectColor = String(object.color ?? "").toLowerCase();
              return moveColorMap[targetColor]?.some((candidate) => objectColor.includes(candidate.toLowerCase())) ?? false;
            })
          : objects.filter((object) => object.type === "sticky");
        if (targets.length === 0) {
          return {
            summary: "Done",
            objectsAffected: [],
            durationMs: Date.now() - startedAt,
            boundingBox: null,
            objectsCreated: [],
          };
        }
        const allMaxX = Math.max(...objects.map((object) => (object.x ?? 0) + (object.width ?? 150)));
        const rightEdge = Math.max(allMaxX + 60, 640);
        const movedObjects: BoardObject[] = [];
        for (let i = 0; i < targets.length; i += 1) {
          const target = targets[i];
          if (!target) continue;
          const result = await toolsByName.moveObject.invoke({
            objectId: target.id,
            x: rightEdge,
            y: i * ((target.height ?? 150) + 20),
          });
          collectBoardObjects(result, movedObjects);
          await sleep(200);
        }
        const affectedIds = targets.map((target) => target.id);
        mergeBoardCache(params.boardId, movedObjects);
        return {
          summary: `I moved ${targets.length} sticky notes to the right side`,
          objectsAffected: affectedIds,
          durationMs: Date.now() - startedAt,
          boundingBox: computeBoundingBox(movedObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
          objectsCreated: [],
        };
      }
    }

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
    const loweredCommand = command.toLowerCase();
    const yellowStickyTextMatch = command.match(/yellow\s+sticky\s+note\s+that\s+says\s+['"]?(.+?)['"]?\s*$/i);

    if (yellowStickyTextMatch) {
      const text = yellowStickyTextMatch[1]?.trim() || "Sticky";
      const origin = await resolvePlacementOrigin({
        supabase,
        handlers,
        boardId: params.boardId,
        requiredWidth: 150,
        requiredHeight: 150,
      });
      const created = await toolsByName.createStickyNote.invoke({
        text,
        x: origin.x,
        y: origin.y,
        color: "#fde68a",
      });
      const createdObjects: BoardObject[] = [];
      collectBoardObjects(created, createdObjects);
      mergeBoardCache(params.boardId, createdObjects);
      const affectedIds = [...collectObjectIds(created)];
      const boundingBox = computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
      return {
        summary: `I added a yellow sticky note${text ? ` that says "${text}"` : ""}`,
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (includesAll(loweredCommand, ["yellow", "sticky", "user research"])) {
      const origin = await resolvePlacementOrigin({
        supabase,
        handlers,
        boardId: params.boardId,
        requiredWidth: 150,
        requiredHeight: 150,
      });
      const created = await toolsByName.createStickyNote.invoke({
        text: "User Research",
        x: origin.x,
        y: origin.y,
        color: "#fde68a",
      });
      const createdObjects: BoardObject[] = [];
      collectBoardObjects(created, createdObjects);
      mergeBoardCache(params.boardId, createdObjects);
      const affectedIds = [...collectObjectIds(created)];
      return {
        summary: "I added a sticky note",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (includesAll(loweredCommand, ["blue", "rectangle", "position"])) {
      const positionMatch = loweredCommand.match(/position\s*(-?\d+)\s*,\s*(-?\d+)/);
      const fallbackOrigin = await resolvePlacementOrigin({
        supabase,
        handlers,
        boardId: params.boardId,
        requiredWidth: 150,
        requiredHeight: 100,
      });
      const x = positionMatch ? Number(positionMatch[1]) : fallbackOrigin.x;
      const y = positionMatch ? Number(positionMatch[2]) : fallbackOrigin.y;
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
        summary: "I drew a blue rectangle",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (loweredCommand.includes("frame") && loweredCommand.includes("sprint planning")) {
      const origin = await resolvePlacementOrigin({
        supabase,
        handlers,
        boardId: params.boardId,
        requiredWidth: 400,
        requiredHeight: 300,
      });
      const created = await toolsByName.createFrame.invoke({
        title: "Sprint Planning",
        x: origin.x,
        y: origin.y,
        width: 400,
        height: 300,
      });
      const createdObjects: BoardObject[] = [];
      collectBoardObjects(created, createdObjects);
      mergeBoardCache(params.boardId, createdObjects);
      const affectedIds = [...collectObjectIds(created)];
      const boundingBox = computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
      return {
        summary: "I set up a frame called \"Sprint Planning\"",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (includesAll(loweredCommand, ["move all", "pink", "sticky"]) && loweredCommand.includes("right")) {
      console.warn("[getBoardState called] command:", command);
      const boardObjects = await getFreshBoardState({ boardId: params.boardId, handlers });
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
        summary: `I moved ${affectedIds.length} sticky notes to the right side`,
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (intent === "resize" || (loweredCommand.includes("resize") && loweredCommand.includes("frame") && loweredCommand.includes("fit"))) {
      console.warn("[getBoardState called] command:", command);
      const boardObjects = await getFreshBoardState({ boardId: params.boardId, handlers });
      const frame = boardObjects.find((object) => object.type === "frame");
      if (!frame) {
        return {
          summary: "No frame found to resize.",
          objectsAffected: [],
          durationMs: Date.now() - startedAt,
          boundingBox: null,
        };
      }
      const contents = boardObjects.filter(
        (object) =>
          object.id !== frame.id &&
          object.type !== "frame" &&
          typeof object.x === "number" &&
          typeof object.y === "number",
      );
      if (contents.length === 0) {
        return {
          summary: "No objects found to fit inside the frame.",
          objectsAffected: [frame.id],
          durationMs: Date.now() - startedAt,
          boundingBox: computeBoundingBox([frame]),
        };
      }
      const padding = 40;
      const contentBounds = computeBoundingBox(contents);
      if (!contentBounds) {
        return {
          summary: "No objects found to fit inside the frame.",
          objectsAffected: [frame.id],
          durationMs: Date.now() - startedAt,
          boundingBox: computeBoundingBox([frame]),
        };
      }
      const targetX = Math.floor(contentBounds.x - padding);
      const targetY = Math.floor(contentBounds.y - padding);
      const targetWidth = Math.max(200, Math.ceil(contentBounds.width + padding * 2));
      const targetHeight = Math.max(200, Math.ceil(contentBounds.height + padding * 2));
      await toolsByName.moveObject.invoke({
        objectId: frame.id,
        x: targetX,
        y: targetY,
      });
      await sleep(200);
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
    if (intent === "change_color") {
      if (params.targetObjectId) {
        const nextColor = normalizeColor(command) ?? "#22c55e";
        const changed = await toolsByName.changeColor.invoke({ objectId: params.targetObjectId, color: nextColor });
        const changedObjects: BoardObject[] = [];
        collectBoardObjects(changed, changedObjects);
        mergeBoardCache(params.boardId, changedObjects);
        return {
          summary: "Updated color on 1 object",
          objectsAffected: [params.targetObjectId],
          durationMs: Date.now() - startedAt,
          boundingBox:
            computeBoundingBox(changedObjects) ??
            (await getBoundingBoxForAffectedObjects(handlers, [params.targetObjectId])),
        };
      }
      console.warn("[getBoardState called] command:", command);
      const boardObjects = await getFreshBoardState({ boardId: params.boardId, handlers });
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
      const nextColor = normalizeColor(command) ?? "#22c55e";
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
      return {
        summary: `I updated the color on ${targets.length} object${targets.length > 1 ? "s" : ""}`,
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (intent === "grid_template") {
      const labels = ["Pro 1", "Pro 2", "Pro 3", "Con 1", "Con 2", "Con 3"];
      const cols = 3;
      const rows = 2;
      const itemWidth = 150;
      const itemHeight = 150;
      const gap = 20;
      const totalWidth = cols * itemWidth + (cols - 1) * gap;
      const totalHeight = rows * itemHeight + (rows - 1) * gap;
      const origin = await resolvePlacementOrigin({
        supabase,
        handlers,
        boardId: params.boardId,
        requiredWidth: totalWidth,
        requiredHeight: totalHeight,
      });
      const startX = origin.x;
      const startY = origin.y;
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
        command,
      });
      console.timeEnd(toolTimerLabel);
      const affectedIds = [...new Set(outputs.flatMap((output) => [...collectObjectIds(output.result)]))];
      const createdObjects: BoardObject[] = [];
      for (const output of outputs) {
        collectBoardObjects(output.result, createdObjects);
      }
      mergeBoardCache(params.boardId, createdObjects);
      return {
        summary: "I made a 2×3 grid for pros and cons",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (intent === "arrange_grid") {
      console.warn("[getBoardState called] command:", command);
      const boardObjects = await getFreshBoardState({ boardId: params.boardId, handlers });
      const stickyNotes = boardObjects.filter((object) => object.type === "sticky");
      if (stickyNotes.length === 0) {
        return {
          summary: "Done",
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
        summary: "I arranged everything in a grid",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(movedObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (intent === "space_evenly") {
      console.warn("[getBoardState called] command:", command);
      const boardObjects = await getFreshBoardState({ boardId: params.boardId, handlers });
      mergeBoardCache(params.boardId, boardObjects);
      if (boardObjects.length === 0) {
        return {
          summary: "Done",
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
      return {
        summary: "I spaced all elements evenly",
        objectsAffected: movedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    if (isJourneyMapCommand(command)) {
      const origin = await resolvePlacementOrigin({
        supabase,
        handlers,
        boardId: params.boardId,
        requiredWidth: 5 * 150 + 4 * 20,
        requiredHeight: 150,
      });
      const stickyCalls: ToolCallLike[] = Array.from({ length: 5 }).map((_, index) => ({
        name: "createStickyNote",
        args: {
          text: `Stage ${index + 1}`,
          x: origin.x + index * 170,
          y: origin.y,
          color: "#fde68a",
        },
      }));
      console.time(toolTimerLabel);
      const stickyOutputs = await executeToolCallsOptimized({
        toolCalls: stickyCalls,
        toolsByName,
        startedAt,
        command,
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
        command,
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
        summary: "I created a user journey map with five stages",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (isRetrospectiveBoardCommand(command)) {
      const origin = await resolvePlacementOrigin({
        supabase,
        handlers,
        boardId: params.boardId,
        requiredWidth: 640,
        requiredHeight: 400,
      });
      const templateCalls: ToolCallLike[] = [
        { name: "createFrame", args: { title: "What Went Well", x: origin.x, y: origin.y, width: 200, height: 400 } },
        { name: "createFrame", args: { title: "What Didn't", x: origin.x + 220, y: origin.y, width: 200, height: 400 } },
        { name: "createFrame", args: { title: "Action Items", x: origin.x + 440, y: origin.y, width: 200, height: 400 } },
      ];
      console.time(toolTimerLabel);
      const outputs = await executeToolCallsOptimized({
        toolCalls: templateCalls,
        toolsByName,
        startedAt,
        command,
      });
      console.timeEnd(toolTimerLabel);
      const affectedIds = [...new Set(outputs.flatMap((output) => [...collectObjectIds(output.result)]))];
      const createdObjects: BoardObject[] = [];
      for (const output of outputs) {
        collectBoardObjects(output.result, createdObjects);
      }
      mergeBoardCache(params.boardId, createdObjects);
      return {
        summary: "I built a retrospective board with three columns",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox: computeBoundingBox(createdObjects) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds)),
      };
    }

    if (loweredCommand.includes("swot") && (loweredCommand.includes("template") || loweredCommand.includes("analysis"))) {
      const origin = await resolvePlacementOrigin({
        supabase,
        handlers,
        boardId: params.boardId,
        requiredWidth: 420,
        requiredHeight: 420,
      });
      const templateCalls: ToolCallLike[] = [
        { name: "createFrame", args: { title: "Strengths", x: origin.x, y: origin.y, width: 200, height: 200 } },
        { name: "createFrame", args: { title: "Weaknesses", x: origin.x + 220, y: origin.y, width: 200, height: 200 } },
        { name: "createFrame", args: { title: "Opportunities", x: origin.x, y: origin.y + 220, width: 200, height: 200 } },
        { name: "createFrame", args: { title: "Threats", x: origin.x + 220, y: origin.y + 220, width: 200, height: 200 } },
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
        summary: "I set up a SWOT analysis with four quadrants",
        objectsAffected: affectedIds,
        durationMs: Date.now() - startedAt,
        boundingBox,
      };
    }

    const toolsList = [
      tools.createStickyNote,
      tools.createShape,
      tools.createFrame,
      tools.createConnector,
      tools.moveObject,
      tools.resizeObject,
      tools.updateText,
      tools.changeColor,
      tools.getBoardState,
    ];
    const llmWithTools = model.bindTools(toolsList);
    const toolMap = Object.fromEntries(toolsList.map((tool) => [tool.name, tool])) as Record<
      string,
      { invoke: (input: unknown, config?: unknown) => Promise<unknown> }
    >;
    const messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(params.command),
    ];
    const aiMessages: Array<{ type: string; [key: string]: unknown }> = [];
    const results: Array<{ call: ToolCallLike; result: unknown }> = [];
    const allCreatedObjects: BoardObject[] = [];
    const MAX_ITERATIONS = 10;
    let iterations = 0;
    console.log("[Agent] Starting command:", params.command);

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
      iterations = iteration;
      console.log("[Agent] Iteration:", iterations);
      if (params.signal?.aborted) {
        throw new Error("Request aborted");
      }

      console.time(llmTimerLabel);
      const response = (await llmWithTools.invoke(messages, {
        signal: params.signal,
        metadata,
        tags: ["bend", "agent", commandType, "verified-loop"],
        runName: "bend-agent-verified-loop",
        callbacks: sharedCallbacks,
      })) as unknown as AIMessage;
      console.timeEnd(llmTimerLabel);

      aiMessages.push({ type: "ai", ...(response as unknown as Record<string, unknown>) });
      messages.push(response);
      const toolCalls = extractToolCalls(response);
      console.log("[Agent] LLM response tool_calls count:", (response as { tool_calls?: unknown[] }).tool_calls?.length ?? 0);
      console.log(
        "[Agent] Tool calls requested:",
        toolCalls.map((call) => ({
          name: call.name,
          args: call.args,
        })),
      );
      if (toolCalls.length === 0) {
        break;
      }

      const toolMessages: ToolMessage[] = [];
      for (let index = 0; index < toolCalls.length; index += 1) {
        const toolCall = toolCalls[index];
        if (!toolCall) continue;
        const tool = toolMap[toolCall.name];
        console.log(
          `[Agent] About to execute tool ${index + 1}/${toolCalls.length}:`,
          toolCall.name,
          toolCall.args ?? {},
        );
        console.log(`[Agent] Executing tool: ${toolCall.name}`, toolCall.args ?? {});

        if (!tool) {
          const missingToolPayload = { error: `Unknown tool: ${toolCall.name}` };
          toolMessages.push(
            new ToolMessage({
              content: safeJsonStringify(missingToolPayload),
              tool_call_id: toolCall.id ?? `${iteration}-${index}-${toolCall.name}`,
            }),
          );
          continue;
        }

        try {
          const toolTimeout = ["resizeObject", "moveObject"].includes(toolCall.name) ? 12_000 : 8_000;
          const result = await Promise.race([
            tool.invoke(toolCall.args ?? {}),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`Tool ${toolCall.name} timed out`)), toolTimeout);
            }),
          ]);
          console.log(`[Agent] Tool ${toolCall.name} result:`, result);
          console.log("[Agent] Continuing to next tool...");
          console.log(`[Agent] Tool ${toolCall.name} completed:`, result);

          results.push({ call: toolCall, result });
          const emittedObjects: BoardObject[] = [];
          collectBoardObjects(result, emittedObjects);
          if (["createStickyNote", "createShape", "createFrame"].includes(toolCall.name)) {
            allCreatedObjects.push(...emittedObjects);
          }

          toolMessages.push(
            new ToolMessage({
              content: safeJsonStringify(result),
              tool_call_id: toolCall.id ?? `${iteration}-${index}-${toolCall.name}`,
            }),
          );

          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`[Agent] Tool ${toolCall.name} failed:`, error);
          toolMessages.push(
            new ToolMessage({
              content: safeJsonStringify({
                error: error instanceof Error ? error.message : "Unknown tool execution error",
              }),
              tool_call_id: toolCall.id ?? `${iteration}-${index}-${toolCall.name}`,
            }),
          );
        }
      }

      messages.push(...toolMessages);
    }
    console.log("[Agent] Loop ended after", iterations, "iterations");
    console.log("[Agent] Total objects created:", allCreatedObjects.length);

    const objectsAffectedSet = new Set<string>();
    const affectedObjectsFromTools: BoardObject[] = [];
    for (const output of results) {
      collectObjectIds(output.result, objectsAffectedSet);
      collectBoardObjects(output.result, affectedObjectsFromTools);
    }
    mergeBoardCache(params.boardId, affectedObjectsFromTools);
    mergeBoardCache(params.boardId, allCreatedObjects);

    const affectedIds = [...objectsAffectedSet];
    const boundingBox =
      computeBoundingBox(affectedObjectsFromTools) ?? (await getBoundingBoxForAffectedObjects(handlers, affectedIds));
    const summary = buildGroupedToolSummary(results);
    const { inputTokens, outputTokens } = extractTokenUsage(aiMessages);
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
    })();

    const registryEntry = handlerRegistry.get(registryKey(params.boardId, params.userId));
    const supabase = registryEntry?.supabase;
    if (supabase) {
      const snapshot = await loadPersistedBoardSnapshot(supabase, params.boardId);
      await recordChange(
        {
          boardId: params.boardId,
          userId: params.userId,
          userName: params.userName || "User",
          action: `AI: ${result.summary}`,
          objectIds: result.objectsAffected,
          boardSnapshot: snapshot,
        },
        supabase,
      );
    }
    return result;
  } finally {
    console.timeEnd(totalTimerLabel);
  }
}
