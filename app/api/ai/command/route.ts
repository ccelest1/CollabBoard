import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { registerBoardMutationHandlers, runAgentCommand } from "@/lib/ai/agent";
import { createRealtimeMutationHandlers } from "@/lib/ai/realtimeMutationHandlers";

type AiCommandRequest = {
  command?: string;
  boardId?: string;
  userId?: string;
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

function getTimeoutMs(command: string): number {
  const lower = command.toLowerCase();
  if (["swot", "journey map", "retrospective", "kanban", "template", "quadrant"].some((k) => lower.includes(k))) {
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
    const timeoutMs = getTimeoutMs(command);
    const result = await Promise.race([
      runAgentCommand({
        command,
        boardId,
        userId,
        signal: request.signal,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`timeout:${timeoutMs}`)), timeoutMs);
      }),
    ]);
    const runFinishedAt = Date.now();
    console.log("[AI timing] runAgentCommand returned", {
      atMs: runFinishedAt,
      runDurationMs: runFinishedAt - runStartedAt,
      sinceRequestMs: runFinishedAt - requestStartedAt,
    });

    if (result.durationMs > 2000) {
      console.warn("[AI command latency warning]", { command, durationMs: result.durationMs });
    }

    const response = NextResponse.json({
      summary: result.summary,
      objectsAffected: result.objectsAffected,
      durationMs: result.durationMs,
    });
    const responseAt = Date.now();
    console.log("[AI timing] response sent", {
      atMs: responseAt,
      totalDurationMs: responseAt - requestStartedAt,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (request.signal.aborted || message.includes("aborted") || message.includes("AbortError")) {
      return NextResponse.json({ error: "Request aborted" }, { status: 499 });
    }
    if (message.startsWith("timeout:")) {
      return NextResponse.json(
        {
          error:
            'Command timed out. For complex commands like color changes across multiple objects, try: "Change all sticky notes to green" and wait up to 30 seconds.',
        },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: "AI command failed" }, { status: 500 });
  }
}
