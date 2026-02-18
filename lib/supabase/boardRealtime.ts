import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { BoardObject } from "@/lib/boards/model";

export type BoardRealtimeEvent =
  | {
      type: "upsert_object";
      sessionId: string;
      sentAt: number;
      object: BoardObject;
    }
  | {
      type: "delete_objects";
      sessionId: string;
      sentAt: number;
      ids: string[];
      updatedAt: number;
    }
  | {
      type: "cursor_move";
      sessionId: string;
      sentAt: number;
      userId: string;
      label: string;
      color: string;
      boardName?: string;
      worldX: number;
      worldY: number;
    }
  | {
      type: "snapshot_request";
      sessionId: string;
      sentAt: number;
      requesterSessionId: string;
    }
  | {
      type: "snapshot_response";
      sessionId: string;
      sentAt: number;
      targetSessionId: string;
      objects: BoardObject[];
      boardName?: string;
    };

const BOARD_EVENT_NAME = "board_event";

export function createBoardEventsChannel(
  supabase: SupabaseClient,
  boardId: string,
  onEvent: (event: BoardRealtimeEvent) => void,
) {
  const channel = supabase.channel(`board:${boardId}:events`);
  channel.on("broadcast", { event: BOARD_EVENT_NAME }, ({ payload }) => {
    onEvent(payload as BoardRealtimeEvent);
  });
  return channel;
}

export function subscribeChannel(channel: RealtimeChannel) {
  return new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        resolve();
      }
    });
  });
}

export async function sendBoardRealtimeEvent(channel: RealtimeChannel, payload: BoardRealtimeEvent) {
  await channel.send({
    type: "broadcast",
    event: BOARD_EVENT_NAME,
    payload,
  });
}
