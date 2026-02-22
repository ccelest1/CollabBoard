import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBoardEventsChannel,
  sendBoardRealtimeEvent,
  subscribeChannel,
  type BoardRealtimeEvent,
} from "@/lib/supabase/boardRealtime";
import {
  loadPersistedBoardSnapshot,
  mutatePersistedBoardSnapshot,
  savePersistedBoardSnapshot,
} from "@/lib/supabase/boardStateStore";
import {
  createBoardObject,
  normalizeBoardObjects,
  upsertBoardObject,
  type BoardObject,
  type BoardStateNormalized,
} from "@/lib/boards/model";
import type { BoardMutationHandlers } from "@/lib/ai/tools";

function centerOf(object: BoardObject) {
  if (object.type === "line") {
    const x2 = object.x2 ?? object.x + object.width;
    const y2 = object.y2 ?? object.y;
    return { x: (object.x + x2) / 2, y: (object.y + y2) / 2 };
  }
  return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
}

async function withCurrentState(supabase: SupabaseClient, boardId: string) {
  const snapshot = await loadPersistedBoardSnapshot(supabase, boardId);
  const state = normalizeBoardObjects(snapshot.objects);
  return { snapshot, state };
}

function toSnapshot(state: BoardStateNormalized) {
  return state.order.map((id) => state.objects[id]).filter((value): value is BoardObject => Boolean(value));
}

async function broadcastEvent(supabase: SupabaseClient, boardId: string, event: BoardRealtimeEvent) {
  const channel = createBoardEventsChannel(supabase, boardId, () => {
    // no-op for server-side sender
  });
  try {
    await subscribeChannel(channel);
    await sendBoardRealtimeEvent(channel, event);
  } finally {
    await channel.unsubscribe();
    supabase.removeChannel(channel);
  }
}

async function persistAndBroadcastUpsert(
  supabase: SupabaseClient,
  boardId: string,
  state: BoardStateNormalized,
  boardName: string | undefined,
  object: BoardObject,
) {
  await savePersistedBoardSnapshot(supabase, boardId, {
    objects: toSnapshot(state),
    boardName,
  });
  await verifyPersistedObjectAndBroadcast(supabase, boardId, object);
}

async function verifyPersistedObjectAndBroadcast(
  supabase: SupabaseClient,
  boardId: string,
  object: BoardObject,
) {
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 200);
  });
  const verification = await loadPersistedBoardSnapshot(supabase, boardId);
  const found = verification.objects.find((candidate) => candidate.id === object.id);
  if (!found) {
    console.error("[persistAndBroadcastUpsert] Object not found after write - Supabase may be lagging", {
      boardId,
      objectId: object.id,
    });
  } else {
    console.log("[persistAndBroadcastUpsert] Verified object persisted", {
      boardId,
      objectId: object.id,
    });
  }
  await broadcastEvent(supabase, boardId, {
    type: "upsert_object",
    sessionId: `ai-agent:${object.updatedBy}`,
    sentAt: Date.now(),
    object,
  });
}

export function createRealtimeMutationHandlers(params: {
  supabase: SupabaseClient;
  boardId: string;
  userId: string;
}): BoardMutationHandlers {
  const { supabase, boardId, userId } = params;

  return {
    createStickyNote: async ({ text, x, y, color }) => {
      const created = createBoardObject("sticky", { x, y }, userId);
      const nextObject: BoardObject = {
        ...created,
        text,
        color,
        width: 150,
        height: 150,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      await mutatePersistedBoardSnapshot(supabase, boardId, async (current) => {
        const state = normalizeBoardObjects(current.objects);
        const nextState = upsertBoardObject(state, nextObject);
        return {
          objects: toSnapshot(nextState),
          boardName: current.boardName,
        };
      });
      await verifyPersistedObjectAndBroadcast(supabase, boardId, nextObject);
      return nextObject;
    },

    createShape: async ({ type, x, y, width, height, color }) => {
      const created = createBoardObject(type, { x, y }, userId);
      const nextObject: BoardObject = {
        ...created,
        width,
        height,
        color,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      await mutatePersistedBoardSnapshot(supabase, boardId, async (current) => {
        const state = normalizeBoardObjects(current.objects);
        const nextState = upsertBoardObject(state, nextObject);
        return {
          objects: toSnapshot(nextState),
          boardName: current.boardName,
        };
      });
      await verifyPersistedObjectAndBroadcast(supabase, boardId, nextObject);
      return nextObject;
    },

    createFrame: async ({ title, x, y, width, height }) => {
      const created = createBoardObject("frame", { x, y }, userId);
      const nextObject: BoardObject = {
        ...created,
        text: title,
        width,
        height,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      await mutatePersistedBoardSnapshot(supabase, boardId, async (current) => {
        const state = normalizeBoardObjects(current.objects);
        const nextState = upsertBoardObject(state, nextObject);
        return {
          objects: toSnapshot(nextState),
          boardName: current.boardName,
        };
      });
      await verifyPersistedObjectAndBroadcast(supabase, boardId, nextObject);
      return nextObject;
    },

    createConnector: async ({ fromId, toId, style }) => {
      const { snapshot, state } = await withCurrentState(supabase, boardId);
      const fromObject = state.objects[fromId];
      const toObject = state.objects[toId];
      if (!fromObject || !toObject) {
        throw new Error("Connector endpoints not found");
      }
      const from = centerOf(fromObject);
      const to = centerOf(toObject);
      const created = createBoardObject("line", from, userId);
      const nextObject: BoardObject = {
        ...created,
        x: from.x,
        y: from.y,
        x2: to.x,
        y2: to.y,
        width: Math.max(1, Math.abs(to.x - from.x)),
        height: Math.max(1, Math.abs(to.y - from.y)),
        lineStyle: style,
        startObjectId: fromObject.id,
        endObjectId: toObject.id,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      const nextState = upsertBoardObject(state, nextObject);
      await persistAndBroadcastUpsert(supabase, boardId, nextState, snapshot.boardName, nextObject);
      return nextObject;
    },

    moveObject: async ({ objectId, x, y }) => {
      const { snapshot, state } = await withCurrentState(supabase, boardId);
      const existing = state.objects[objectId];
      if (!existing) {
        throw new Error("Object not found");
      }
      const deltaX = x - existing.x;
      const deltaY = y - existing.y;
      const nextObject: BoardObject = {
        ...existing,
        x,
        y,
        x2: typeof existing.x2 === "number" ? existing.x2 + deltaX : existing.x2,
        y2: typeof existing.y2 === "number" ? existing.y2 + deltaY : existing.y2,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      const nextState = upsertBoardObject(state, nextObject);
      await persistAndBroadcastUpsert(supabase, boardId, nextState, snapshot.boardName, nextObject);
      return nextObject;
    },

    resizeObject: async ({ objectId, width, height }) => {
      const { snapshot, state } = await withCurrentState(supabase, boardId);
      const existing = state.objects[objectId];
      if (!existing) {
        throw new Error("Object not found");
      }
      const nextObject: BoardObject = {
        ...existing,
        width,
        height,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      const nextState = upsertBoardObject(state, nextObject);
      await persistAndBroadcastUpsert(supabase, boardId, nextState, snapshot.boardName, nextObject);
      return nextObject;
    },

    updateText: async ({ objectId, newText }) => {
      const { snapshot, state } = await withCurrentState(supabase, boardId);
      const existing = state.objects[objectId];
      if (!existing) {
        throw new Error("Object not found");
      }
      const nextObject: BoardObject = {
        ...existing,
        text: newText,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      const nextState = upsertBoardObject(state, nextObject);
      await persistAndBroadcastUpsert(supabase, boardId, nextState, snapshot.boardName, nextObject);
      return nextObject;
    },

    changeColor: async ({ objectId, color }) => {
      const { snapshot, state } = await withCurrentState(supabase, boardId);
      const existing = state.objects[objectId];
      if (!existing) {
        throw new Error("Object not found");
      }
      const nextObject: BoardObject = {
        ...existing,
        color,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      const nextState = upsertBoardObject(state, nextObject);
      await persistAndBroadcastUpsert(supabase, boardId, nextState, snapshot.boardName, nextObject);
      return nextObject;
    },

    deleteObject: async ({ objectId }) => {
      const { snapshot, state } = await withCurrentState(supabase, boardId);
      const existing = state.objects[objectId];
      if (!existing) {
        return { deleted: false, objectId };
      }
      const nextOrder = state.order.filter((id) => id !== objectId);
      const nextObjects = { ...state.objects };
      delete nextObjects[objectId];
      await savePersistedBoardSnapshot(supabase, boardId, {
        objects: nextOrder.map((id) => nextObjects[id]).filter((value): value is BoardObject => Boolean(value)),
        boardName: snapshot.boardName,
      });
      await broadcastEvent(supabase, boardId, {
        type: "delete_objects",
        sessionId: `ai-agent:${userId}`,
        sentAt: Date.now(),
        ids: [objectId],
        updatedAt: Date.now(),
      });
      return { deleted: true, objectId };
    },

    getBoardObjects: async () => {
      const { snapshot } = await withCurrentState(supabase, boardId);
      return snapshot.objects;
    },
  };
}
