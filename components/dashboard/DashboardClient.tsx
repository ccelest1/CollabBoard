"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createOwnedBoard,
  deleteOwnedBoard,
  getBoards,
  getMostRecentlyVisitedBoardId,
  renameOwnedBoard,
  sanitizeBoardId,
  type BoardRecord,
} from "@/lib/boards/store";
import { savePersistedBoardSnapshot } from "@/lib/supabase/boardStateStore";

type ViewMode = "grid" | "table";
type DashboardClientProps = {
  userId: string;
};

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString();
}

export function DashboardClient({ userId }: DashboardClientProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [boardName, setBoardName] = useState("");
  const [joinBoardId, setJoinBoardId] = useState("");
  const [boards, setBoards] = useState<BoardRecord[]>([]);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<BoardRecord | null>(null);
  const [editingName, setEditingName] = useState("");
  const [joinError, setJoinError] = useState("");

  const userScope = userId;

  useEffect(() => {
    let active = true;

    const verifySession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;
      if (!session) {
        router.replace("/login?redirect=/dashboard");
      }
    };

    void verifySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        router.replace("/login?redirect=/dashboard");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  useEffect(() => {
    if (!userScope) return;
    setBoards(getBoards(userScope));
    setBoardsLoaded(true);
  }, [version, userScope]);

  useEffect(() => {
    const onStorageChange = (event: StorageEvent) => {
      if (!event.key) return;
      if (
        event.key.startsWith("bend.boards.v1:") ||
        event.key === "bend.boardCatalog.v1" ||
        event.key === "bend.boardSync.v1"
      ) {
        setVersion((current) => current + 1);
      }
    };
    const onWindowFocus = () => {
      setVersion((current) => current + 1);
    };
    const onBoardStoreUpdated = () => {
      setVersion((current) => current + 1);
    };
    const pollInterval = window.setInterval(() => {
      setVersion((current) => current + 1);
    }, 2000);

    window.addEventListener("storage", onStorageChange);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("bend:boards-updated", onBoardStoreUpdated);
    return () => {
      window.clearInterval(pollInterval);
      window.removeEventListener("storage", onStorageChange);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("bend:boards-updated", onBoardStoreUpdated);
    };
  }, []);

  const ownedBoards = useMemo(
    () => boards.filter((board) => board.owned).sort((a, b) => b.lastVisitedAt - a.lastVisitedAt),
    [boards],
  );
  const visitedBoards = useMemo(
    () => boards.filter((board) => !board.owned).sort((a, b) => b.lastVisitedAt - a.lastVisitedAt),
    [boards],
  );

  const handleCreateBoard = async () => {
    if (!userScope) return;
    const id = createOwnedBoard(userScope, boardName);
    const normalizedName = boardName.trim();
    await savePersistedBoardSnapshot(supabase, id, {
      objects: [],
      boardName: normalizedName || "Untitled Board",
    });
    setBoardName("");
    setVersion((current) => current + 1);
    router.push(`/board/${id}`);
  };

  const handleJoinBoard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = sanitizeBoardId(joinBoardId);
    if (!id) return;
    setJoinError("");
    setJoinBoardId("");
    router.push(`/board/${id}`);
  };

  useEffect(() => {
    const preserved = window.history.state ?? {};
    window.history.replaceState({ ...preserved, dashboardLock: true }, "", window.location.href);
    const handlePopState = () => {
      if (!userScope) return;
      const recentBoardId = getMostRecentlyVisitedBoardId(userScope);
      if (recentBoardId) {
        router.replace(`/board/${recentBoardId}`);
        return;
      }
      const nextState = window.history.state ?? {};
      window.history.replaceState({ ...nextState, dashboardLock: true }, "", window.location.href);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [router, userScope]);

  const boardCard = (board: BoardRecord) => (
    <div key={board.id} className="rounded-lg border border-slate-300 bg-white p-3.5">
      <button
        type="button"
        onClick={() => router.push(`/board/${board.id}`)}
        className="text-left text-base font-semibold text-slate-900 underline-offset-2 hover:underline"
      >
        {board.name || "Untitled Board"}
      </button>
      <p className="mt-1 text-sm text-slate-500">{board.id}</p>
      <p className="mt-1 text-sm text-slate-500">Created {formatDate(board.createdAt)}</p>
      {board.owned ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing(board);
              setEditingName(board.name || "");
            }}
            className="rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              if (!userScope) return;
              deleteOwnedBoard(board.id, userScope);
              setVersion((current) => current + 1);
            }}
            className="rounded border border-red-300 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-400">Read-only board</p>
      )}
    </div>
  );

  const boardTable = (items: BoardRecord[], isOwned: boolean) => (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="border-b border-slate-200 px-3 py-2 text-left">Board ID</th>
            <th className="border-b border-slate-200 px-3 py-2 text-left">Board Name</th>
            <th className="border-b border-slate-200 px-3 py-2 text-left">Created</th>
            <th className="border-b border-slate-200 px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-sm text-slate-500">
                No boards yet.
              </td>
            </tr>
          ) : (
            items.map((board) => (
              <tr key={board.id}>
                <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-700">{board.id}</td>
                <td className="border-b border-slate-100 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => router.push(`/board/${board.id}`)}
                    className="text-left underline-offset-2 hover:underline"
                  >
                    {board.name || "Untitled Board"}
                  </button>
                </td>
                <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-500">
                  {formatDate(board.createdAt)}
                </td>
                <td className="border-b border-slate-100 px-3 py-2">
                  {isOwned ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(board);
                          setEditingName(board.name || "");
                        }}
                        className="rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!userScope) return;
                          deleteOwnedBoard(board.id, userScope);
                          setVersion((current) => current + 1);
                        }}
                        className="rounded border border-red-300 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <span className="text-sm text-slate-400">No edit access</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const boardRail = (items: BoardRecord[], isOwned: boolean, emptyLabel: string) => (
    <div className="rounded-lg border border-slate-300 bg-white p-3">
      {items.length === 0 ? (
        <p className="py-3 text-base text-slate-500">{emptyLabel}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((board) => boardCard({ ...board, owned: isOwned ? board.owned : false }))}</div>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl min-h-[calc(100vh-11rem)] rounded-xl border border-slate-300/70 bg-white/60 px-6 py-6 shadow-sm backdrop-blur-md md:px-7 md:py-8">
      <div className="relative min-h-[132px] md:min-h-[120px]">
        <h1 className="text-center text-4xl font-semibold text-slate-900"> Dashboard</h1>
        <button
          type="button"
          onClick={() => router.push("/boardverse")}
          className="absolute left-0 top-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Go to BENDverse
        </button>
        <div className="absolute right-0 top-2 rounded-lg border border-slate-300 bg-white/90 p-3 shadow-sm">
          <div className="rounded-lg border border-slate-200 p-2">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">View mode</p>
            <div className="rounded-md border border-slate-200 p-1.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`rounded px-3 py-1 text-sm ${viewMode === "grid" ? "bg-slate-900 text-white" : "text-slate-700"}`}
              >
                Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`ml-1 rounded px-3 py-1 text-sm ${viewMode === "table" ? "bg-slate-900 text-white" : "text-slate-700"}`}
              >
                Table
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-xl border border-slate-300 bg-white p-5">
          <p className="text-center text-base font-semibold text-slate-900">Create Board Name</p>
          <input
            value={boardName}
            onChange={(event) => setBoardName(event.target.value)}
            placeholder="Board name (optional)"
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-base text-center"
          />
          <button
            type="button"
            onClick={handleCreateBoard}
            className="mt-3 w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-base font-medium text-slate-700 hover:bg-slate-50"
          >
            Create New Board
          </button>

          <form onSubmit={handleJoinBoard} className="mt-10">
            <p className="text-center text-base font-semibold text-slate-900">Join Existing Board</p>
            <input
              value={joinBoardId}
              onChange={(event) => setJoinBoardId(sanitizeBoardId(event.target.value))}
              placeholder="Paste Board ID"
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-center text-base"
            />
            <button
              type="submit"
              className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-base font-medium text-white hover:bg-slate-800"
            >
              Join Board
            </button>
            {joinError ? <p className="mt-2 text-center text-xs text-red-600">{joinError}</p> : null}
          </form>
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-slate-300 bg-white p-4">
            <h2 className="text-xl font-semibold text-slate-900">Owned Boards</h2>
            <div className="mt-3">
              {viewMode === "grid" ? (
                boardRail(ownedBoards, true, "No owned boards yet.")
              ) : (
                boardTable(boardsLoaded ? ownedBoards : [], true)
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-300 bg-white p-4">
            <h2 className="text-xl font-semibold text-slate-900">Visited Boards</h2>
            <p className="text-sm text-slate-500">Not owned by you</p>
            <div className="mt-3">
              {viewMode === "grid" ? (
                boardRail(visitedBoards, false, "No visited boards yet.")
              ) : (
                boardTable(boardsLoaded ? visitedBoards : [], false)
              )}
            </div>
          </section>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Edit Board</h3>
            <p className="mt-1 text-xs text-slate-500">{editing.id}</p>
            <input
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              placeholder="Board name"
              className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!userScope) return;
                  renameOwnedBoard(editing.id, editingName, userScope);
                  setEditing(null);
                  setVersion((current) => current + 1);
                }}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
