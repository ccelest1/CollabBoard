import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type VersionHistoryRecord = {
  id: string;
  board_id: string;
  user_id: string;
  user_name: string;
  action: string;
  object_ids: string[] | null;
  created_at: string;
};

function resolveClient(client?: SupabaseClient) {
  return client ?? createClient();
}

export async function recordChange(
  params: {
    boardId: string;
    userId: string;
    userName: string;
    action: string;
    objectIds: string[];
    boardSnapshot: unknown;
  },
  client?: SupabaseClient,
) {
  const supabase = resolveClient(client);
  const { error: vError } = await supabase.from("board_version_history").insert({
    board_id: params.boardId,
    user_id: params.userId,
    user_name: params.userName,
    action: params.action,
    object_ids: params.objectIds,
    snapshot: params.boardSnapshot,
  });
  if (vError) console.error("[versionHistory] insert failed:", vError);

  const { error: uError } = await supabase.from("board_user_changes").insert({
    board_id: params.boardId,
    user_id: params.userId,
    user_name: params.userName,
    action: params.action,
    object_ids: params.objectIds,
  });
  if (uError) console.error("[userChanges] insert failed:", uError);
}

export async function loadVersionHistory(boardId: string, limit = 50, client?: SupabaseClient) {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("board_version_history")
    .select("id, user_id, user_name, action, object_ids, created_at")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[versionHistory] load failed:", error);
    return [] as VersionHistoryRecord[];
  }
  return (data ?? []) as VersionHistoryRecord[];
}

export async function loadUserChanges(boardId: string, limit = 50, client?: SupabaseClient) {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("board_user_changes")
    .select("id, user_id, user_name, action, object_ids, created_at")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[userChanges] load failed:", error);
    return [] as VersionHistoryRecord[];
  }
  return (data ?? []) as VersionHistoryRecord[];
}

export async function loadSnapshot(versionId: string, client?: SupabaseClient) {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("board_version_history")
    .select("snapshot")
    .eq("id", versionId)
    .single();
  if (error) {
    console.error("[snapshot] load failed:", error);
    return null;
  }
  return (data as { snapshot?: unknown } | null)?.snapshot ?? null;
}

export async function revertToVersion(
  params: {
    versionId: string;
    boardId: string;
    userId: string;
    userName: string;
  },
  client?: SupabaseClient,
) {
  const supabase = resolveClient(client);
  const snapshot = await loadSnapshot(params.versionId, supabase);
  if (!snapshot) return { success: false, reason: "No snapshot available" };

  const { error } = await supabase.from("board_states").upsert(
    {
      board_id: params.boardId,
      payload: snapshot,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "board_id" },
  );

  if (error) return { success: false, reason: error.message };

  await recordChange(
    {
      boardId: params.boardId,
      userId: params.userId,
      userName: params.userName,
      action: "Reverted to earlier version",
      objectIds: [],
      boardSnapshot: snapshot,
    },
    supabase,
  );

  return { success: true };
}
