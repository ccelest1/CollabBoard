"use client";

import React, { useEffect, useRef, useState, type KeyboardEvent } from "react";

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
  onCommandSuccess?: (boundingBox: { x: number; y: number; width: number; height: number } | null) => void;
};

export function AIAgentPanel({ boardId, userId, onCommandSuccess }: AIAgentPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedCommand, setSubmittedCommand] = useState("");
  const resetTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetToIdle = () => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setInputValue("");
    setIsExecuting(false);
    setExecutionLog([]);
    setResult(null);
    setError(null);
    setSubmittedCommand("");
  };

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const submitCommand = async (rawCommand?: string) => {
    const command = (rawCommand ?? inputValue).trim();
    if (!command || isExecuting) return;
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    setIsExecuting(true);
    setResult(null);
    setError(null);
    setSubmittedCommand(command);
    setExecutionLog(["Preparing request...", "Sending command to AI agent..."]);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({ command, boardId, userId }),
      });
      const payload = (await response.json()) as {
        summary?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "AI command failed");
      }
      setExecutionLog((current) => [...current, "Applying board updates...", "Done."]);
      setResult(payload.summary?.trim() || "Done");
      onCommandSuccess?.(null);
      setInputValue("");
      setIsExecuting(false);
      abortControllerRef.current = null;
      resetTimerRef.current = window.setTimeout(() => {
        resetToIdle();
      }, 3000);
    } catch (caught) {
      const aborted =
        (caught instanceof DOMException && caught.name === "AbortError") ||
        (caught instanceof Error && caught.message.toLowerCase().includes("abort"));
      const message = aborted ? "Command cancelled" : caught instanceof Error ? caught.message : "AI command failed";
      setExecutionLog((current) => [...current, aborted ? "Command cancelled." : "Request failed."]);
      setError(message);
      setIsExecuting(false);
      abortControllerRef.current = null;
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submitCommand(inputValue);
  };

  return (
    <div className="pointer-events-none absolute bottom-5 right-5 z-20 flex flex-col items-end gap-2">
      {isOpen ? (
        <div className="pointer-events-auto min-w-[320px] w-[320px] rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
          <p className="text-sm font-semibold text-slate-900">AI Agent</p>
          <div className="mt-2 min-h-[188px]">
            {isExecuting ? (
              <div className="pt-1">
                <p className="animate-pulse text-sm text-slate-500">AI is working...</p>
                <p
                  className="mt-2 text-[11px] italic text-slate-400"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {submittedCommand}
                </p>
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      abortControllerRef.current?.abort();
                    }}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : result ? (
              <p className="text-xs leading-5 text-slate-700">{result}</p>
            ) : error ? (
              <div>
                <p className="text-xs leading-5 text-red-600">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setExecutionLog([]);
                  }}
                  className="mt-2 text-[11px] font-medium text-slate-600 underline-offset-2 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <div>
                <p className="text-xs text-slate-500">Suggested Prompts:</p>
                <div className="mt-1.5 flex flex-col">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => {
                        setInputValue(prompt);
                        void submitCommand(prompt);
                      }}
                      className="w-full rounded px-1.5 py-1 text-left text-xs text-slate-700 outline-none transition hover:bg-gray-100 focus:outline-none whitespace-normal break-words"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-2">
            <textarea
              rows={3}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={isExecuting}
              className="w-full resize-none rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50"
              placeholder="Type an AI command..."
            />
            <p className="mt-1 text-right text-[10px] text-slate-400">ⓘ Press Enter to Submit Request</p>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="pointer-events-auto h-20 w-20 rounded-2xl border border-slate-400 bg-white shadow-sm"
      >
        <div className="flex h-full w-full items-center justify-center rounded-2xl text-base font-semibold">AI</div>
      </button>
    </div>
  );
}
