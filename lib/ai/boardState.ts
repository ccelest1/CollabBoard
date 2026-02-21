import type { BoardObject } from "@/lib/boards/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPersistedBoardSnapshot } from "@/lib/supabase/boardStateStore";

export type SerializedBoardObject = {
  id: string;
  type: BoardObject["type"];
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text?: string;
  parentId?: string;
};

export type SerializedBoardState = {
  objects: SerializedBoardObject[];
};

function serializeBoardObject(object: BoardObject): SerializedBoardObject {
  return {
    id: object.id,
    type: object.type,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    color: object.color,
    text: object.text,
    parentId: object.parentFrameId,
  };
}

export function serializeBoardState(objects: BoardObject[]): SerializedBoardState {
  return {
    objects: objects.map(serializeBoardObject),
  };
}

export async function getBoardState(supabase: SupabaseClient, boardId: string): Promise<SerializedBoardState> {
  const snapshot = await loadPersistedBoardSnapshot(supabase, boardId);
  console.log("[getBoardState]", {
    boardId,
    objectCount: snapshot.objects?.length ?? 0,
    objects: snapshot.objects,
  });

  if (!snapshot.objects || snapshot.objects.length === 0) {
    console.warn("[getBoardState] Board returned empty - possible write lag or save failure");
  }

  return serializeBoardState(snapshot.objects ?? []);
}
