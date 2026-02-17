"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function generateBoardId() {
  return crypto.randomUUID().split("-")[0];
}

export function BoardActions() {
  const router = useRouter();
  const [joinId, setJoinId] = useState("");

  const handleCreate = () => {
    router.push(`/board/${generateBoardId()}`);
  };

  const handleJoin = (event: React.FormEvent) => {
    event.preventDefault();
    const sanitized = joinId.trim().toLowerCase().replace(/\s+/g, "-");
    if (!sanitized) return;
    router.push(`/board/${sanitized}`);
  };

  return (
    <div className="mt-6 grid w-full max-w-3xl gap-4 md:grid-cols-2">
      <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Create New Board</h2>
        <p className="mt-1 text-sm text-slate-600">
          Start with an empty board and share the URL with collaborators.
        </p>
        <button
          type="button"
          onClick={handleCreate}
          className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Create board
        </button>
      </section>

      <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Join Existing Board</h2>
        <p className="mt-1 text-sm text-slate-600">
          Paste a board id from a collaborator URL to join.
        </p>
        <form onSubmit={handleJoin} className="mt-4 space-y-3">
          <input
            value={joinId}
            onChange={(event) => setJoinId(event.target.value)}
            placeholder="board-id"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            type="submit"
            className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Join board
          </button>
        </form>
      </section>
    </div>
  );
}
