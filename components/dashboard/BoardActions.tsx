"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

function createBoardId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function BoardActions() {
  const router = useRouter();
  const [boardId, setBoardId] = useState("");

  const goToBoard = (id: string) => {
    const trimmedId = id.trim();
    if (!trimmedId) return;
    router.push(`/board/${trimmedId}`);
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    goToBoard(boardId);
  };

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => goToBoard(createBoardId())}
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
      >
        Create New Board
      </button>

      <form onSubmit={handleJoin} className="space-y-3">
        <label htmlFor="board-id" className="block text-sm font-medium text-slate-700">
          Join Existing Board
        </label>
        <input
          id="board-id"
          value={boardId}
          onChange={(event) => setBoardId(event.target.value)}
          placeholder="Paste board id"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        <button
          type="submit"
          className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Join Board
        </button>
      </form>
    </div>
  );
}
