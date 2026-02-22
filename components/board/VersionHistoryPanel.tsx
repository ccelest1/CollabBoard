"use client";

import { useEffect, useMemo, useState } from "react";
import { loadUserChanges, loadVersionHistory, revertToVersion } from "@/lib/supabase/versionHistory";

type VersionHistoryPanelProps = {
  boardId: string;
  userId: string;
  userName: string;
  isOpen: boolean;
  onClose: () => void;
  refreshKey?: number;
};

type HistoryTab = "all" | "by-user";
type HistoryEntry = {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  object_ids: string[] | null;
  created_at: string;
};

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function GhostActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2 py-1 text-[11px] text-slate-600 transition hover:bg-slate-100"
    >
      {label}
    </button>
  );
}

function userAvatar(entry: HistoryEntry) {
  const name = (entry.user_name || "User").trim();
  const isAi = entry.action.startsWith("AI:") || /ai/i.test(name);
  if (isAi) {
    return (
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#FEF3C7",
          color: "#92400E",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          marginRight: 6,
        }}
      >
        ⚡
      </span>
    );
  }
  const initial = name.charAt(0).toUpperCase() || "U";
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "#EEF2FF",
        color: "#4338CA",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 600,
        marginRight: 6,
      }}
    >
      {initial}
    </span>
  );
}

export function VersionHistoryPanel({ boardId, userId, userName, isOpen, onClose, refreshKey = 0 }: VersionHistoryPanelProps) {
  const pageSize = 50;
  const [tab, setTab] = useState<HistoryTab>("all");
  const [versionEntries, setVersionEntries] = useState<HistoryEntry[]>([]);
  const [userEntries, setUserEntries] = useState<HistoryEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});

  const groupedByUser = useMemo(() => {
    return userEntries.reduce(
      (acc, entry) => {
        const key = entry.user_id || "unknown";
        if (!acc[key]) acc[key] = { userName: entry.user_name || "User", entries: [] as HistoryEntry[] };
        acc[key]?.entries.push(entry);
        return acc;
      },
      {} as Record<string, { userName: string; entries: HistoryEntry[] }>,
    );
  }, [userEntries]);

  const fetchEntries = async (nextOffset = 0, mode: "replace" | "append" = "replace") => {
    setLoading(true);
    const versionData = await loadVersionHistory(boardId, pageSize + nextOffset);
    const userData = await loadUserChanges(boardId, pageSize + nextOffset);
    const slicedVersion = mode === "append" ? versionData.slice(0, pageSize + nextOffset) : versionData.slice(0, pageSize);
    const slicedUsers = mode === "append" ? userData.slice(0, pageSize + nextOffset) : userData.slice(0, pageSize);
    setVersionEntries(slicedVersion);
    setUserEntries(slicedUsers);
    setHasMore(versionData.length > slicedVersion.length);
    setOffset(slicedVersion.length);
    setLoading(false);
  };

  const onLoadMore = () => {
    if (!hasMore || loading) return;
    void fetchEntries(offset, "append");
  };

  const copyAction = async (entry: HistoryEntry) => {
    try {
      await navigator.clipboard.writeText(entry.action);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((current) => (current === entry.id ? null : current)), 1500);
    } catch {
      setStatusMessage("Copy failed");
      window.setTimeout(() => setStatusMessage(null), 1500);
    }
  };

  const revertAction = async (entry: HistoryEntry) => {
    const confirmed = window.confirm("Revert to before this change?");
    if (!confirmed) return;
    const result = await revertToVersion({
      versionId: entry.id,
      boardId,
      userId,
      userName,
    });
    if (result.success) {
      setStatusMessage("Reverted");
      window.setTimeout(() => window.location.reload(), 500);
      return;
    }
    setStatusMessage(result.reason ?? "Cannot revert this action");
    window.setTimeout(() => setStatusMessage(null), 1800);
  };

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const loadInitial = async () => {
      const [versionData, userData] = await Promise.all([loadVersionHistory(boardId, 50), loadUserChanges(boardId, 50)]);
      if (!active) return;
      setVersionEntries(versionData);
      setUserEntries(userData);
      setOffset(versionData.length);
      setHasMore(versionData.length === 50);
    };
    void loadInitial();
    const timer = window.setInterval(loadInitial, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [boardId, isOpen, refreshKey]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute right-0 z-[55] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white max-[440px]:left-4 max-[440px]:right-4 max-[440px]:w-auto"
      style={{
        top: "calc(100% + 8px)",
        width: "min(400px, calc(100vw - 32px))",
        maxHeight: 480,
        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #F3F4F6",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>History</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close version history"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#6B7280",
            fontSize: 16,
          }}
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2">
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`px-3 py-1 text-[13px] ${tab === "all" ? "rounded-md bg-slate-200 font-medium text-slate-900" : "text-slate-500"}`}
        >
          Version History
        </button>
        <button
          type="button"
          onClick={() => setTab("by-user")}
          className={`px-3 py-1 text-[13px] ${tab === "by-user" ? "rounded-md bg-slate-200 font-medium text-slate-900" : "text-slate-500"}`}
        >
          User Changes
        </button>
      </div>
      {statusMessage ? <p className="px-3 py-1 text-[11px] text-slate-500">{statusMessage}</p> : null}
      <div className="flex-1 overflow-y-auto">
        {tab === "by-user"
          ? Object.entries(groupedByUser).map(([key, group]) => {
              const isOpenGroup = expandedUsers[key] ?? true;
              const sample = group.entries[0];
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => setExpandedUsers((current) => ({ ...current, [key]: !isOpenGroup }))}
                    className="flex w-full items-center gap-1 px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <span>{isOpenGroup ? "▼" : "▶"}</span>
                    {sample ? userAvatar(sample) : null}
                    <span>{`${group.userName} (${group.entries.length} changes)`}</span>
                  </button>
                  {isOpenGroup
                    ? group.entries.map((entry) => (
                        <div
                          key={entry.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 16px",
                            borderBottom: "1px solid #F9FAFB",
                            fontSize: 12,
                          }}
                        >
                          {userAvatar(entry)}
                          <div className="min-w-0 flex-1">
                            <span
                              title={entry.action}
                              className="inline-block max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap text-slate-800"
                            >
                              {entry.action}
                            </span>
                            <p className="text-[11px] text-slate-500">{formatRelativeTime(new Date(entry.created_at))}</p>
                          </div>
                          <GhostActionButton label="Revert" onClick={() => void revertAction(entry)} />
                          <GhostActionButton label={copiedId === entry.id ? "Copied!" : "Copy"} onClick={() => copyAction(entry)} />
                        </div>
                      ))
                    : null}
                </div>
              );
            })
          : versionEntries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 16px",
                  borderBottom: "1px solid #F9FAFB",
                  fontSize: 12,
                }}
              >
                {userAvatar(entry)}
                <p className="w-20 truncate font-medium text-slate-700">{entry.user_name}</p>
                <span
                  title={entry.action}
                  className="inline-block max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap text-slate-800"
                >
                  {entry.action}
                </span>
                <p className="w-14 text-right text-[11px] text-slate-500">{formatRelativeTime(new Date(entry.created_at))}</p>
                <GhostActionButton label="Revert" onClick={() => void revertAction(entry)} />
                <GhostActionButton label={copiedId === entry.id ? "Copied!" : "Copy"} onClick={() => copyAction(entry)} />
              </div>
            ))}
        {!loading && versionEntries.length === 0 ? <p className="px-4 py-4 text-xs text-slate-500">No history yet.</p> : null}
      </div>
      {loading ? <p className="px-3 py-2 text-xs text-slate-500">Loading...</p> : null}
      {hasMore ? (
        <div className="border-t border-slate-100 p-2">
          <button
            type="button"
            onClick={onLoadMore}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}
