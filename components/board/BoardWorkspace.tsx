"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { markBoardVisited } from "@/lib/boards/store";

type BoardWorkspaceProps = {
  boardId: string;
  userLabel: string;
  userId: string;
};

type ToolId = "hand" | "cursor" | "sticky" | "rectangle" | "circle" | "line";

type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

type PresenceCursorPayload = {
  sessionId: string;
  userId: string;
  label: string;
  color: string;
  worldX: number;
  worldY: number;
  sentAt: number;
};

type RemoteCursor = PresenceCursorPayload & {
  key: string;
  receivedAt: number;
};

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 64;
const BASE_DOT_SPACING = 56;
const MIN_SCREEN_DOT_SPACING = 14;
const CURSOR_BROADCAST_MIN_INTERVAL_MS = 20;
const CURSOR_STALE_TIMEOUT_MS = 10_000;

const TOOLBAR_ITEMS: Array<{ id: ToolId; icon: string; description: string }> = [
  { id: "hand", icon: "✋", description: "Hand (drag board)" },
  { id: "cursor", icon: "", description: "Cursor (select objects)" },
  { id: "sticky", icon: "🗒️", description: "Sticky note" },
  { id: "rectangle", icon: "▭", description: "Rectangle" },
  { id: "circle", icon: "◯", description: "Circle" },
  { id: "line", icon: "─", description: "Line" },
];

function colorFromSeed(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 55%)`;
}

export function BoardWorkspace({ boardId, userLabel, userId }: BoardWorkspaceProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, pixelRatio: 1 });
  const viewportRef = useRef<Viewport>({ x: 600, y: 360, zoom: 1 });
  const isDraggingRef = useRef(false);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({
    x: 600,
    y: 360,
    zoom: 1,
  });
  const [activeTool, setActiveTool] = useState<ToolId>("cursor");
  const [isDragging, setIsDragging] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});

  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const sessionIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const lastCursorSentAtRef = useRef(0);

  const userColor = colorFromSeed(userLabel || "user");

  const canvasCursor =
    activeTool === "hand" ? (isDragging ? "grabbing" : "grab") : activeTool === "cursor" ? "default" : "crosshair";

  const drawBoard = (nextViewport: Viewport) => {
    const context = contextRef.current;
    if (!context) return;

    const { width, height, pixelRatio } = sizeRef.current;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    const left = -nextViewport.x / nextViewport.zoom;
    const top = -nextViewport.y / nextViewport.zoom;
    const right = (width - nextViewport.x) / nextViewport.zoom;
    const bottom = (height - nextViewport.y) / nextViewport.zoom;

    const baseScreenSpacing = BASE_DOT_SPACING * nextViewport.zoom;
    const spacingMultiplier = Math.max(
      1,
      Math.ceil(MIN_SCREEN_DOT_SPACING / Math.max(baseScreenSpacing, 0.0001)),
    );
    const worldSpacing = BASE_DOT_SPACING * spacingMultiplier;

    const firstX = Math.floor(left / worldSpacing) * worldSpacing;
    const firstY = Math.floor(top / worldSpacing) * worldSpacing;
    const dotRadius = Math.max(0.5, 1.4 / nextViewport.zoom);

    context.save();
    context.translate(nextViewport.x, nextViewport.y);
    context.scale(nextViewport.zoom, nextViewport.zoom);
    context.fillStyle = "rgba(100, 116, 139, 0.28)";

    for (let x = firstX; x <= right; x += worldSpacing) {
      for (let y = firstY; y <= bottom; y += worldSpacing) {
        context.beginPath();
        context.arc(x, y, dotRadius, 0, Math.PI * 2);
        context.fill();
      }
    }

    context.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;
    contextRef.current = context;

    const resizeCanvas = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);

      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      sizeRef.current = { width, height, pixelRatio };

      drawBoard(viewportRef.current);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  useEffect(() => {
    viewportRef.current = viewport;
    drawBoard(viewport);
  }, [viewport]);

  useEffect(() => {
    markBoardVisited(boardId, userId);
  }, [boardId, userId]);

  useEffect(() => {
    const channel = supabase.channel(`board:${boardId}:presence`, {
      config: {
        presence: {
          key: `${userId}:${sessionIdRef.current}`,
        },
      },
    });
    presenceChannelRef.current = channel;

    const syncRemoteCursors = () => {
      const now = Date.now();
      const next: Record<string, RemoteCursor> = {};
      const state = channel.presenceState<PresenceCursorPayload>();

      for (const key of Object.keys(state)) {
        const metas = state[key] ?? [];
        const newest = metas[metas.length - 1];
        if (!newest) continue;
        if (newest.sessionId === sessionIdRef.current) continue;
        next[key] = {
          key,
          ...newest,
          receivedAt: now,
        };
      }

      setRemoteCursors(next);
    };

    channel.on("presence", { event: "sync" }, syncRemoteCursors);
    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      await channel.track({
        sessionId: sessionIdRef.current,
        userId,
        label: userLabel,
        color: userColor,
        worldX: 0,
        worldY: 0,
        sentAt: Date.now(),
      } satisfies PresenceCursorPayload);
    });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      if (presenceChannelRef.current === channel) {
        presenceChannelRef.current = null;
      }
      setRemoteCursors({});
    };
  }, [boardId, supabase, userColor, userId, userLabel]);

  useEffect(() => {
    const prune = window.setInterval(() => {
      const now = Date.now();
      setRemoteCursors((current) => {
        let changed = false;
        const next: Record<string, RemoteCursor> = {};
        for (const [key, cursor] of Object.entries(current)) {
          if (now - cursor.sentAt <= CURSOR_STALE_TIMEOUT_MS) {
            next[key] = cursor;
          } else {
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 2000);

    return () => {
      window.clearInterval(prune);
    };
  }, []);

  const zoomAtScreenPoint = (screenX: number, screenY: number, zoomFactor: number) => {
    setViewport((current) => {
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * zoomFactor));
      if (nextZoom === current.zoom) return current;

      const worldX = (screenX - current.x) / current.zoom;
      const worldY = (screenY - current.y) / current.zoom;
      const nextX = screenX - worldX * nextZoom;
      const nextY = screenY - worldY * nextZoom;

      return {
        x: nextX,
        y: nextY,
        zoom: nextZoom,
      };
    });
  };

  const maybeTrackCursor = (screenX: number, screenY: number) => {
    const worldX = (screenX - viewportRef.current.x) / viewportRef.current.zoom;
    const worldY = (screenY - viewportRef.current.y) / viewportRef.current.zoom;

    const now = Date.now();
    if (now - lastCursorSentAtRef.current < CURSOR_BROADCAST_MIN_INTERVAL_MS) {
      return;
    }

    const channel = presenceChannelRef.current;
    if (!channel) return;
    lastCursorSentAtRef.current = now;
    channel.track({
      sessionId: sessionIdRef.current,
      userId,
      label: userLabel,
      color: userColor,
      worldX,
      worldY,
      sentAt: now,
    } satisfies PresenceCursorPayload);
  };

  const handleCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    maybeTrackCursor(event.clientX, event.clientY);
    if (activeTool !== "hand") return;

    isDraggingRef.current = true;
    dragPointerIdRef.current = event.pointerId;
    dragOriginRef.current = {
      x: event.clientX,
      y: event.clientY,
      startX: viewport.x,
      startY: viewport.y,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    maybeTrackCursor(event.clientX, event.clientY);
    if (!isDraggingRef.current || activeTool !== "hand") return;
    if (dragPointerIdRef.current !== event.pointerId) return;
    if (!dragOriginRef.current) return;

    const nextX = dragOriginRef.current.startX + (event.clientX - dragOriginRef.current.x);
    const nextY = dragOriginRef.current.startY + (event.clientY - dragOriginRef.current.y);
    setViewport((current) => ({ ...current, x: nextX, y: nextY }));
  };

  const stopDragging = () => {
    isDraggingRef.current = false;
    dragPointerIdRef.current = null;
    dragOriginRef.current = null;
    setIsDragging(false);
  };

  const handleCanvasPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    maybeTrackCursor(event.clientX, event.clientY);
    if (dragPointerIdRef.current === event.pointerId) {
      stopDragging();
    }
  };

  const handleCanvasWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const zoomFactor = event.deltaY > 0 ? 0.92 : 1.08;
    zoomAtScreenPoint(pointerX, pointerY, zoomFactor);
  };

  const zoomFromButtons = (direction: "in" | "out") => {
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;
    zoomAtScreenPoint(width / 2, height / 2, direction === "in" ? 1.15 : 1 / 1.15);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.replace("/login");
    setSigningOut(false);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-white text-slate-900">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block"
        style={{ cursor: canvasCursor }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={stopDragging}
        onWheel={handleCanvasWheel}
      />

      <div className="absolute left-5 top-4 rounded-xl border border-slate-400 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">CollabBoard</span>
          <span className="text-slate-400">|</span>
          <span>Board Name</span>
          <button
            type="button"
            className="rounded-md border border-slate-400 px-3 py-1 text-xs hover:bg-slate-50"
          >
            Options
          </button>
        </div>
      </div>

      <div className="absolute right-5 top-4 rounded-xl border border-slate-400 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-3 text-sm">
          <span className="h-10 w-10 rounded-full border border-slate-400" style={{ backgroundColor: userColor }} />
          <span>{userLabel}</span>
          <button
            type="button"
            className="rounded-md border border-slate-400 px-3 py-1 text-xs hover:bg-slate-50"
          >
            Request Different Access
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-md border border-slate-400 px-4 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {signingOut ? "Signing out..." : "Sign Out"}
          </button>
        </div>
      </div>

      <div className="absolute left-5 top-24 w-44 rounded-xl border border-slate-400 bg-white px-3 py-3 shadow-sm">
        <p className="text-sm">Board Id:</p>
        <p className="mt-1 truncate text-xs text-slate-500">{boardId}</p>
        <p className="mt-3 text-sm">Zoom:</p>
        <p className="mt-1 text-xs text-slate-500">{Math.round(viewport.zoom * 100)}%</p>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm">Collaborators:</p>
          <div className="flex -space-x-2">
            <span className="h-7 w-7 rounded-full border border-slate-400 bg-white" />
            <span className="h-7 w-7 rounded-full border border-slate-400 bg-slate-100" />
          </div>
        </div>
      </div>

      <div className="absolute bottom-6 left-5 rounded-xl border border-slate-400 bg-white p-1 shadow-sm">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomFromButtons("in")}
            className="h-9 w-9 rounded-md text-lg font-semibold text-slate-700 hover:bg-slate-100"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomFromButtons("out")}
            className="h-9 w-9 rounded-md text-lg font-semibold text-slate-700 hover:bg-slate-100"
          >
            -
          </button>
        </div>
      </div>

      <div className="absolute bottom-5 right-5 h-20 w-20 rounded-2xl border border-slate-400 bg-white shadow-sm">
        <div className="flex h-full w-full items-center justify-center rounded-2xl text-base font-semibold">AI</div>
      </div>

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-2xl border border-slate-400 bg-white p-2 shadow-sm">
        <div className="flex items-center gap-2">
          {TOOLBAR_ITEMS.map((item) => {
            const isActive = activeTool === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.description}
                onClick={() => {
                  setActiveTool(item.id);
                  if (item.id !== "hand") {
                    stopDragging();
                  }
                }}
                className={`group relative flex h-12 w-12 items-center justify-center rounded-xl border text-xl transition ${isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
              >
                {item.id === "cursor" ? (
                  <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
                    <path
                      d="M4 2L19 12L12 13L14.5 21L10.5 22L8 14L4 18V2Z"
                      fill="currentColor"
                      stroke="currentColor"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span>{item.icon}</span>
                )}
                <span className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">
                  {item.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {Object.values(remoteCursors).map((cursor) => {
        const left = viewport.x + cursor.worldX * viewport.zoom;
        const top = viewport.y + cursor.worldY * viewport.zoom;
        return (
          <div
            key={cursor.key}
            data-testid={`remote-cursor-${cursor.key}`}
            data-user-id={cursor.userId}
            data-session-id={cursor.sessionId}
            data-sent-at={String(cursor.sentAt)}
            data-received-at={String(cursor.receivedAt)}
            className="pointer-events-none absolute z-30"
            style={{ left, top, transform: "translate(-2px, -2px)" }}
          >
            <div className="h-4 w-4 rotate-45 rounded-[2px]" style={{ backgroundColor: cursor.color }} />
            <div
              className="mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium text-white shadow-sm"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
