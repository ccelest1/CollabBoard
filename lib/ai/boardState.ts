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
  const resolvedBoardId = boardId.trim();
  const snapshot = await loadPersistedBoardSnapshot(supabase, resolvedBoardId);
  const objects = snapshot.objects ?? [];
  const bySource = objects.reduce<Record<string, number>>((acc, object) => {
    const source =
      typeof (object as unknown as { source?: unknown }).source === "string"
        ? String((object as unknown as { source?: unknown }).source)
        : "user";
    acc[source] = (acc[source] ?? 0) + 1;
    return acc;
  }, {});
  void bySource;

  if (objects.length === 0) {
    console.warn("[getBoardState] Board returned empty - possible write lag or save failure");
  }

  return serializeBoardState(objects);
}

export async function findEmptyPlacement(params: {
  supabase: SupabaseClient;
  boardId: string;
  requiredWidth: number;
  requiredHeight: number;
  padding?: number;
}): Promise<{ x: number; y: number }> {
  const padding = params.padding ?? 40;
  const state = await getBoardState(params.supabase, params.boardId);
  const objects = state.objects;
  if (objects.length === 0) {
    return { x: 0, y: 0 };
  }

  const maxX = Math.max(...objects.map((object) => (object.x ?? 0) + (object.width ?? params.requiredWidth)));
  const maxY = Math.max(...objects.map((object) => (object.y ?? 0) + (object.height ?? params.requiredHeight)));
  const minX = Math.min(...objects.map((object) => object.x ?? 0));
  const minY = Math.min(...objects.map((object) => object.y ?? 0));
  const existingWidth = maxX - minX;

  if (existingWidth < 1200) {
    return { x: maxX + padding, y: minY };
  }
  return { x: minX, y: maxY + padding };
}
