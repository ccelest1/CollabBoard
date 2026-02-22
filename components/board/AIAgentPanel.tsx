"use client";

import React, { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

const SUGGESTED_PROMPTS = [
  "Create a SWOT analysis template with four quadrants",
  "Add a yellow sticky note that says User Research",
  "Change all sticky notes to green",
  "Space these elements evenly",
  "Arrange in a grid",
] as const;

type AIAgentPanelProps = {
  boardId: string;
  userId: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCommandSuccess?: (boundingBox: { x: number; y: number; width: number; height: number } | null) => void;
  boardObjects: Array<{ id: string; type: string }>;
};

type BoardBoundsResponse = {
  bounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    centerX: number;
    centerY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

type ConversationMessage = {
  id: string;
  role: "user" | "ai";
  text: string;
  timestamp: Date;
  animationDone?: boolean;
};

type QueuedCommand = {
  command: string;
  targetObjectId?: string;
};

function formatTimestamp(timestamp: Date) {
  return timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function GhostButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#F3F4F6" : "transparent",
        border: "none",
        borderRadius: 6,
        padding: "4px 10px",
        fontSize: 12,
        color: "#6B7280",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      {label}
    </button>
  );
}

function TypingMessage({ text, onDone }: { text: string; onDone?: () => void }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let i = 0;
    setDisplayed("");
    setDone(false);
    const interval = window.setInterval(() => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(interval);
        setDone(true);
        onDone?.();
      }
    }, 18);
    return () => window.clearInterval(interval);
  }, [text, onDone]);

  return (
    <span>
      {displayed}
      {!done ? (
        <span
          style={{
            display: "inline-block",
            width: 1,
            height: "0.9em",
            background: "#6B7280",
            marginLeft: 1,
            verticalAlign: "middle",
            animation: "blink 0.7s step-end infinite",
          }}
        />
      ) : null}
    </span>
  );
}

export function AIAgentPanel({
  boardId,
  userId,
  isOpen: isOpenProp,
  onOpenChange,
  onCommandSuccess,
  boardObjects,
}: AIAgentPanelProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [commandQueue, setCommandQueue] = useState<QueuedCommand[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submittedCommand, setSubmittedCommand] = useState("");
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const statusTimeoutRef = useRef<number | null>(null);
  const queueRef = useRef<QueuedCommand[]>([]);
  const isProcessingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const isOpen = isOpenProp ?? internalIsOpen;
  const setIsOpen = (open: boolean) => {
    if (typeof isOpenProp === "boolean") {
      onOpenChange?.(open);
      return;
    }
    setInternalIsOpen(open);
    onOpenChange?.(open);
  };

  const showStatusMessage = (message: string) => {
    setStatusMessage(message);
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setStatusMessage(null);
      statusTimeoutRef.current = null;
    }, 4000);
  };

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (statusTimeoutRef.current !== null) {
        window.clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationHistory]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isExecuting) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isExecuting]);

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!isOpen) return;
      if (panelRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, [isOpen]);

  function sanitizeCommand(raw: string): string {
    return raw
      .replace(/^[\s]*[•·‣⁃◦▸▹►\-–—*]+[\s]*/gm, "")
      .replace(/^["'"']+|["'"']+$/g, "")
      .replace(/^[\d]+[.)]\s*/gm, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[\x00-\x1F\x7F]/g, "")
      .trim();
  }

  const submitCommand = async (rawCommand: string, targetObjectId?: string) => {
    const command = sanitizeCommand(rawCommand);
    if (!command) return;
    console.log("[sanitize] raw:", rawCommand);
    console.log("[sanitize] cleaned:", command);
    setStatusMessage(null);
    setSubmittedCommand(command);
    setConversationHistory((current) => [
      ...current,
      {
        id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        role: "user",
        text: command,
        timestamp: new Date(),
      },
    ]);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({ command, boardId, userId, targetObjectId }),
      });
      const payload = (await response.json()) as {
        summary?: string;
        objectsAffected?: string[];
        objectIds?: string[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "AI command failed");
      }
      const objectIds = payload.objectIds ?? payload.objectsAffected ?? [];
      const summary = payload.summary?.trim() || "Done";
      setConversationHistory((current) => [
        ...current,
        {
          id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          role: "ai",
          text: summary,
          timestamp: new Date(),
          animationDone: false,
        },
      ]);
      try {
        const boundsResponse = await fetch(
          `/api/ai/board-bounds?boardId=${encodeURIComponent(boardId)}&objectIds=${encodeURIComponent(objectIds.join(","))}`,
        );
        const boundsPayload = (await boundsResponse.json()) as BoardBoundsResponse;
        onCommandSuccess?.(boundsPayload.bounds ?? null);
      } catch {
        onCommandSuccess?.(null);
      }
      abortControllerRef.current = null;
    } catch (caught) {
      const responseError =
        caught instanceof Error &&
        (caught.message.toLowerCase().includes("timeout") || caught.message.toLowerCase().includes("timed out"))
          ? "Taking too long — please try again"
          : "Something went wrong — please try again";
      const aborted =
        (caught instanceof DOMException && caught.name === "AbortError") ||
        (caught instanceof Error && caught.message.toLowerCase().includes("abort"));
      showStatusMessage(aborted ? "Request stopped" : responseError);
      abortControllerRef.current = null;
    }
  };

  const syncQueue = (next: QueuedCommand[]) => {
    queueRef.current = next;
    setCommandQueue(next);
  };

  const processQueue = async () => {
    if (isProcessingRef.current) return;
    const next = queueRef.current[0];
    if (!next) return;

    isProcessingRef.current = true;
    syncQueue(queueRef.current.slice(1));
    setIsExecuting(true);
    try {
      await submitCommand(next.command, next.targetObjectId);
    } finally {
      setIsExecuting(false);
      setSubmittedCommand("");
      isProcessingRef.current = false;
      if (queueRef.current.length > 0) {
        window.setTimeout(() => {
          void processQueue();
        }, 100);
      }
    }
  };

  const enqueueCommand = (rawCommand?: string, targetObjectId?: string) => {
    const command = (rawCommand ?? inputValue).trim();
    if (!command) {
      showStatusMessage("Please enter a command first");
      return;
    }

    const nextItem: QueuedCommand = { command, targetObjectId: targetObjectId ?? undefined };
    const nextQueue = [...queueRef.current, nextItem];
    syncQueue(nextQueue);
    setInputValue("");
    if (!isProcessingRef.current) {
      void processQueue();
    }
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    enqueueCommand(inputValue);
  };

  const latestAiId = (() => {
    for (let i = conversationHistory.length - 1; i >= 0; i -= 1) {
      const entry = conversationHistory[i];
      if (entry?.role === "ai") return entry.id;
    }
    return "";
  })();

  const markAnimationDone = (id: string) => {
    setConversationHistory((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, animationDone: true } : entry)),
    );
  };

  return (
    <div className="pointer-events-none fixed bottom-20 right-6 z-[55] flex flex-col items-end gap-2">
      {isOpen ? (
        <div
          ref={panelRef}
          className="pointer-events-auto flex h-[520px] w-[min(380px,calc(100vw-32px))] max-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="flex items-center">
            <p className="text-sm font-semibold text-slate-900">AI Agent</p>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
              <GhostButton label="Clear input" onClick={() => setInputValue("")} />
              <GhostButton label="Clear chat" onClick={() => setConversationHistory([])} />
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 16 }}
                aria-label="Close AI panel"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
            {!isExecuting ? (
              <div className="shrink-0">
                <p className="text-xs text-slate-500">Suggested Prompts:</p>
                <div className="mt-1.5 flex h-[180px] flex-col gap-1">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => {
                        setInputValue(prompt);
                        enqueueCommand(prompt);
                      }}
                      className="w-full rounded px-1.5 py-1 text-left text-xs text-slate-700 outline-none transition hover:bg-gray-100 focus:outline-none whitespace-normal break-words"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col">
              <p className="text-xs text-slate-500">Chat History:</p>
              {isExecuting ? (
                <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <p className="animate-pulse text-xs text-slate-500 text-center">AI is working...</p>
                  <p
                    className="mt-1 text-[11px] italic text-slate-400"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {submittedCommand}
                  </p>
                  <div className="mt-2 flex justify-center">
                    <GhostButton
                      label="Cancel"
                      onClick={() => {
                        abortControllerRef.current?.abort();
                        showStatusMessage("Request stopped");
                      }}
                    />
                  </div>
                </div>
              ) : null}
              <div ref={chatContainerRef} className="mt-1 flex max-h-[220px] min-h-[120px] flex-col gap-1.5 overflow-y-auto pr-1">
                {conversationHistory.map((entry) => {
                  const isLatestAI = entry.role === "ai" && entry.id === latestAiId;
                  return (
                  <div key={entry.id} className="flex flex-col">
                    <div className={entry.role === "user" ? "ml-auto max-w-[90%]" : "mr-auto max-w-[90%]"}>
                      <div
                        className={`rounded-2xl px-2.5 py-1.5 text-xs leading-5 ${
                          entry.role === "user" ? "bg-[#DBEAFE] text-blue-900" : "bg-[#F3F4F6] text-slate-800"
                        }`}
                        style={{ width: "fit-content", maxWidth: "85%" }}
                      >
                        {isLatestAI && !entry.animationDone ? (
                          <TypingMessage text={entry.text} onDone={() => markAnimationDone(entry.id)} />
                        ) : (
                          entry.text
                        )}
                      </div>
                      <p className="mt-0.5 px-1 text-[10px] text-slate-400">{formatTimestamp(entry.timestamp)}</p>
                    </div>
                  </div>
                )})}
                <div ref={chatEndRef} style={{ height: 0, flexShrink: 0 }} />
              </div>
              {statusMessage ? (
                <p
                  style={{
                    fontSize: 12,
                    color: "#9CA3AF",
                    textAlign: "center",
                    margin: "8px 0 0",
                    transition: "opacity 0.3s",
                  }}
                >
                  {statusMessage}
                </p>
              ) : null}
              {commandQueue.length > 0 ? (
                <p style={{ fontSize: 11, color: "#9CA3AF", textAlign: "center", marginTop: 6 }}>
                  {commandQueue.length} command{commandQueue.length > 1 ? "s" : ""} queued
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-2 shrink-0">
            <textarea
              rows={2}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={isExecuting}
              placeholder="Ask AI to do something..."
              style={{
                width: "100%",
                resize: "none",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
                background: isExecuting ? "#F9FAFB" : "white",
              }}
            />
            <p className="mt-1 text-right text-[10px] text-slate-400">ⓘ Press Enter to Submit Request</p>
          </div>
        </div>
      ) : null}

      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="pointer-events-auto h-20 w-20 rounded-2xl border border-slate-400 bg-white shadow-sm"
        >
          <div className="flex h-full w-full items-center justify-center rounded-2xl text-base font-semibold">AI</div>
        </button>
      ) : null}
    </div>
  );
}
