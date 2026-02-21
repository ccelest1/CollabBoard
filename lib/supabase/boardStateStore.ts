import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoardObject } from "@/lib/boards/model";

const BOARD_STATE_TABLE = process.env.NEXT_PUBLIC_BOARD_STATE_TABLE ?? "board_states";
const LOCAL_STATE_PREFIX = "collabboard.boardObjects.v1";

export type PersistedBoardSnapshot = {
  objects: BoardObject[];
  boardName?: string;
};

function localStorageKey(boardId: string) {
  return `${LOCAL_STATE_PREFIX}:${boardId}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readLocal(boardId: string) {
  if (!canUseStorage()) return { objects: [] } as PersistedBoardSnapshot;
  try {
    const raw = window.localStorage.getItem(localStorageKey(boardId));
    if (!raw) return { objects: [] } as PersistedBoardSnapshot;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { objects: parsed as BoardObject[] };
    }
    const objects = Array.isArray(parsed?.objects) ? (parsed.objects as BoardObject[]) : [];
    const boardName = typeof parsed?.boardName === "string" ? parsed.boardName : "";
    return { objects, boardName };
  } catch {
    return { objects: [] } as PersistedBoardSnapshot;
  }
}

function writeLocal(boardId: string, snapshot: PersistedBoardSnapshot) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(localStorageKey(boardId), JSON.stringify(snapshot));
}

export async function loadPersistedBoardSnapshot(supabase: SupabaseClient, boardId: string) {
  const isServer = typeof window === "undefined";
  const local = isServer ? ({ objects: [] } as PersistedBoardSnapshot) : readLocal(boardId);
  const { data, error } = await supabase.from(BOARD_STATE_TABLE).select("payload").eq("board_id", boardId).single();

  if (error) {
    console.error("[loadPersistedBoardSnapshot] Supabase read failed:", error);
    return isServer ? ({ objects: [] } as PersistedBoardSnapshot) : local;
  }

  const maybePayload = data?.payload as { objects?: BoardObject[]; boardName?: string } | null;
  const objects = Array.isArray(maybePayload?.objects) ? maybePayload.objects : [];
  const boardName = typeof maybePayload?.boardName === "string" ? maybePayload.boardName : "";
  if (!isServer && (objects.length > 0 || boardName)) {
    writeLocal(boardId, { objects, boardName });
  }
  return { objects, boardName };
}

export async function savePersistedBoardSnapshot(
  supabase: SupabaseClient,
  boardId: string,
  snapshot: PersistedBoardSnapshot,
) {
  writeLocal(boardId, snapshot);

  const payload: { objects: BoardObject[]; boardName?: string } = {
    objects: snapshot.objects,
  };
  if (snapshot.boardName && snapshot.boardName.trim().length > 0) {
    payload.boardName = snapshot.boardName.trim();
  }
  const { error } = await supabase
    .from(BOARD_STATE_TABLE)
    .upsert(
      {
        board_id: boardId,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "board_id" },
    )
    .eq("board_id", boardId);

  if (error) {
    console.error("[savePersistedBoardSnapshot] Supabase write failed:", error);
    throw new Error(`Board state save failed: ${error.message}`);
  }
}
