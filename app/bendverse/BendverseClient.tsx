"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getBoards, type BoardRecord } from "@/lib/boards/store";

type ViewMode = "grid" | "table";
type SortBy = "id" | "date" | "name";

type Props = {
  currentUserId: string;
  userName: string;
};

const BENDVERSE_ID = "BENDVERSE";

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString();
}

function getBoardDisplayName(board: BoardRecord) {
  const trimmedName = board.name?.trim();
  if (trimmedName) return trimmedName;
  if (board.id.toUpperCase() === BENDVERSE_ID) return "BENDVERSE";
  return "BENDVERSE";
}

function UniverseHubCard() {
  const router = useRouter();

  return (
    <section className="mb-8">
      <button type="button" onClick={() => router.push(`/board/${BENDVERSE_ID}`)} className="group block w-full text-left">
        <div className="relative overflow-hidden rounded-lg border border-gray-200/50 bg-gradient-to-r from-gray-900 to-gray-700 px-6 py-12 text-center text-white shadow-2xl">
          <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_center,rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:16px_16px]" />
          <div className="relative z-10">
            <h2 className="text-4xl font-bold">BENDverse Hub</h2>
            <p className="mt-2 text-lg text-slate-100">Global Shared Board</p>
            <span className="mt-6 inline-block rounded-lg bg-white px-8 py-3 text-sm font-semibold text-gray-900 transition group-hover:bg-gray-100">
              Join BENDverse
            </span>
          </div>
        </div>
      </button>
    </section>
  );
}

export default function BendverseClient({ currentUserId, userName }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [boards, setBoards] = useState<BoardRecord[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortBy>("date");

  const clearClientStorage = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    const rejectToLogin = async () => {
      await supabase.auth.signOut();
      clearClientStorage();
      window.location.replace("/login?redirect=/boardverse");
    };

    const verifyUser = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        await rejectToLogin();
        return;
      }
      if (user.id !== currentUserId) {
        await rejectToLogin();
      }
    };

    void verifyUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT" || !session?.user) {
        await rejectToLogin();
        return;
      }
      if (session.user.id !== currentUserId) {
        await rejectToLogin();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [currentUserId, router, supabase]);

  useEffect(() => {
    const refreshBoards = () => {
      const all = getBoards(currentUserId);
      setBoards(all.filter((board) => board.id !== BENDVERSE_ID));
    };
    refreshBoards();

    const onStorageChange = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key.startsWith("bend.boards.v1:") || event.key === "bend.boardCatalog.v1" || event.key === "bend.boardSync.v1") {
        refreshBoards();
      }
    };

    window.addEventListener("storage", onStorageChange);
    window.addEventListener("focus", refreshBoards);
    window.addEventListener("bend:boards-updated", refreshBoards);
    return () => {
      window.removeEventListener("storage", onStorageChange);
      window.removeEventListener("focus", refreshBoards);
      window.removeEventListener("bend:boards-updated", refreshBoards);
    };
  }, [currentUserId]);

  const allBoards = useMemo(() => {
    const copy = [...boards];
    copy.sort((a, b) => {
      if (sortBy === "date") return b.createdAt - a.createdAt;
      return getBoardDisplayName(a).localeCompare(getBoardDisplayName(b));
    });
    return copy;
  }, [boards, sortBy]);

  return (
    <div className="mx-auto w-full max-w-6xl min-h-[calc(100vh-11rem)] rounded-xl border border-slate-300/70 bg-white/60 px-6 py-6 shadow-sm backdrop-blur-md md:px-7 md:py-8">
      <div className="mx-auto max-w-4xl">
        <UniverseHubCard />
      </div>

      <div className="mx-auto mb-4 grid w-full max-w-4xl grid-cols-[176px_1fr] gap-4">
        <div />
        <div>
          <div className="w-fit rounded-lg border border-slate-300 bg-white/90 p-3 shadow-sm">
            <div className="rounded-lg border border-slate-200 p-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">View mode</p>
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

      <div className="mx-auto grid w-full max-w-4xl grid-cols-[176px_1fr] gap-6">
        <aside>
          <div className="w-fit rounded-lg border border-slate-300 bg-white/90 p-3 shadow-sm">
            <div className="rounded-lg border border-slate-200 p-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Sort by</p>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortBy)}
                className="min-w-[140px] rounded border border-slate-300 px-2 py-1 text-sm text-slate-700"
              >
                <option value="date">DATE CREATED</option>
                <option value="name">NAME</option>
              </select>
            </div>
          </div>
        </aside>

        <main className="pl-2 md:pl-4">
          <h2 className="mb-3 text-2xl font-medium text-gray-900">All Boards</h2>
          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {allBoards.map((board) => (
                <Link key={board.id} href={`/board/${board.id}`} className="block rounded-lg border border-slate-300 bg-white p-3.5 transition hover:shadow-md">
                  <h3 className="text-base font-semibold text-slate-900">{getBoardDisplayName(board)}</h3>
                  <p className="mt-1 text-sm text-slate-500">Created {formatDate(board.createdAt)}</p>
                </Link>
              ))}
              {allBoards.length === 0 ? (
                <div className="col-span-full rounded-lg border border-white/30 bg-white/70 p-6 text-center text-sm text-slate-500 backdrop-blur-sm">
                  No boards available.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="min-h-[300px] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 text-left">Board ID</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left">Board Name</th>
                    <th className="border-b border-slate-200 px-3 py-2 text-left">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {allBoards.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-sm text-slate-500">
                        No boards available.
                      </td>
                    </tr>
                  ) : (
                    allBoards.map((board) => (
                      <tr key={board.id} className="hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-700">{board.id}</td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <Link href={`/board/${board.id}`} className="underline-offset-2 hover:underline">
                            {getBoardDisplayName(board)}
                          </Link>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-500">{formatDate(board.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      <span className="sr-only">{userName}</span>
    </div>
  );
}
