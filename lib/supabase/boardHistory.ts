import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

export type HistoryEntry = {
  id: string;
  boardId: string;
  userId: string;
  userName: string;
  action: string;
  createdAt: Date;
  objectIds: string[];
};

export type NewHistoryEntry = Omit<HistoryEntry, "id">;

export const BOARD_HISTORY_SETUP_SQL = `
create table if not exists public.board_history (
  id          uuid primary key default gen_random_uuid(),
  board_id    text not null,
  user_id     text not null,
  user_name   text not null default 'User',
  action      text not null,
  object_ids  text[] default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists board_history_board_id_created_at_idx on public.board_history(board_id, created_at desc);
alter table public.board_history enable row level security;
drop policy if exists "Allow all" on public.board_history;
create policy "Allow all" on public.board_history
  for all using (true) with check (true);
`.trim();

type BoardHistoryRow = {
  id: string;
  board_id: string;
  user_id: string;
  user_name: string;
  action: string;
  object_ids: string[] | null;
  created_at: string;
};

function resolveClient(client?: SupabaseClient) {
  return client ?? createBrowserClient();
}

export async function appendHistoryEntry(entry: NewHistoryEntry, client?: SupabaseClient) {
  const supabase = resolveClient(client);
  const { error } = await supabase.from("board_history").insert({
    board_id: entry.boardId,
    user_id: entry.userId,
    user_name: entry.userName || "User",
    action: entry.action,
    object_ids: entry.objectIds,
    created_at: entry.createdAt.toISOString(),
  });
  if (error) {
    console.error("[boardHistory] append failed:", error);
  }
}

export async function loadHistoryEntries(boardId: string, limit = 50, offset = 0, client?: SupabaseClient): Promise<HistoryEntry[]> {
  const supabase = resolveClient(client);
  const { data, error } = await supabase
    .from("board_history")
    .select("*")
    .eq("board_id", boardId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error || !data) return [];
  return (data as BoardHistoryRow[]).map((row) => ({
    id: row.id,
    boardId: row.board_id,
    userId: row.user_id,
    userName: row.user_name || "User",
    action: row.action,
    objectIds: row.object_ids ?? [],
    createdAt: new Date(row.created_at),
  }));
}
