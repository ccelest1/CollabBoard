import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { registerBoardMutationHandlers, runAgentCommand } from "@/lib/ai/agent";
import { createRealtimeMutationHandlers } from "@/lib/ai/realtimeMutationHandlers";

type AiCommandRequest = {
  command?: string;
  boardId?: string;
  userId?: string;
  userName?: string;
  targetObjectId?: string;
  viewportCenter?: { x: number; y: number };
};

const WINDOW_MS = 60_000;
const MAX_COMMANDS_PER_WINDOW = 10;
const commandTimestampsByUser = new Map<string, number[]>();

function isRateLimited(userId: string, now: number) {
  const timestamps = commandTimestampsByUser.get(userId) ?? [];
  const recent = timestamps.filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_COMMANDS_PER_WINDOW) {
    commandTimestampsByUser.set(userId, recent);
    return true;
  }
  recent.push(now);
  commandTimestampsByUser.set(userId, recent);
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getBulkCreateMatch(command: string): { matched: boolean; count: number } {
  const lowered = command.toLowerCase();
  const pattern =
    /(?:create|add|make|draw)\s+(\d+)\s+(\w+)?\s*(sticky\s*notes?|stickies|rectangles?|circles?|frames?|arrows?|connectors?|textboxes?|text\s*boxes?)/i;
  const match = lowered.match(pattern);
  if (!match) {
    return { matched: false, count: 0 };
  }
  return { matched: true, count: Number.parseInt(match[1] ?? "0", 10) };
}

function getTimeoutMs(command: string): number {
  const lower = command.toLowerCase();
  const bulkCheck = getBulkCreateMatch(command);
  if (bulkCheck.matched) {
    return Math.min(bulkCheck.count * 3000 + 5000, 120000);
  }
  if (
    ["2x3", "3x2", "grid of", "journey map", "stages", "user journey", "retrospective", "swot", "kanban"].some((k) =>
      lower.includes(k),
    )
  ) {
    return 60_000;
  }
  if (["template", "quadrant"].some((k) => lower.includes(k))) {
    return 45_000;
  }
  if (
    ["space", "evenly", "arrange", "align", "distribute", "move all", "change all", "color", "resize all"].some((k) =>
      lower.includes(k),
    )
  ) {
    return 30_000;
  }
  return 10_000;
}

function sanitizeSummary(input: string) {
  const summary = input.trim();
  return summary || "Done";
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  console.log("[AI timing] request received", { atMs: requestStartedAt });
  let payload: AiCommandRequest;
  try {
    payload = (await request.json()) as AiCommandRequest;
  } catch {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const command = payload.command?.trim();
  const boardId = payload.boardId?.trim();
  const userId = payload.userId?.trim();
  const targetObjectId = payload.targetObjectId?.trim();
  const viewportCenter = (payload.viewportCenter as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };

  if (!isNonEmptyString(command) || !isNonEmptyString(boardId) || !isNonEmptyString(userId)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const now = Date.now();
  if (isRateLimited(userId, now)) {
    return NextResponse.json({ error: "Too many commands, please wait" }, { status: 429 });
  }
  if (request.signal.aborted) {
    return NextResponse.json({ error: "Request aborted" }, { status: 499 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    const userName =
      typeof authUser?.user_metadata?.username === "string" && authUser.user_metadata.username.trim().length > 0
        ? authUser.user_metadata.username.trim()
        : typeof authUser?.email === "string"
          ? authUser.email.split("@")[0] ?? userId
          : payload.userName?.trim() || userId;
    registerBoardMutationHandlers({
      boardId,
      userId,
      supabase,
      handlers: createRealtimeMutationHandlers({
        supabase,
        boardId,
        userId,
      }),
    });

    const runStartedAt = Date.now();
    console.log("[AI timing] runAgentCommand called", {
      atMs: runStartedAt,
      sinceRequestMs: runStartedAt - requestStartedAt,
    });
    const result = await runAgentCommand({
      command,
      boardId,
      userId,
      viewportCenter,
      userName,
      targetObjectId,
      signal: request.signal,
    });
    const runFinishedAt = Date.now();
    console.log("[AI timing] runAgentCommand returned", {
      atMs: runFinishedAt,
      runDurationMs: runFinishedAt - runStartedAt,
      sinceRequestMs: runFinishedAt - requestStartedAt,
    });

    if (result.durationMs > 2000) {
      console.warn("[AI command latency warning]", { command, durationMs: result.durationMs });
    }
    console.log("[Route] Agent completed:", {
      objectsCreated: (result as { objectsCreated?: unknown[] }).objectsCreated?.length,
      durationMs: result.durationMs,
    });

    const response = NextResponse.json({
      summary: sanitizeSummary(result.summary),
      objectsAffected: result.objectsAffected,
      objectIds: result.objectsAffected,
      durationMs: result.durationMs,
      boundingBox: result.boundingBox ?? null,
    });
    const responseAt = Date.now();
    console.log("[AI timing] response sent", {
      atMs: responseAt,
      totalDurationMs: responseAt - requestStartedAt,
    });
    return response;
  } catch (error) {
    void error;
    return NextResponse.json({
      summary: "I couldn't process that command — please try rephrasing",
      objectsAffected: [],
      objectIds: [],
      durationMs: 0,
    }, { status: 200 });
  }
}
