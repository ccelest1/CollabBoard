"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, Point } from "fabric";
import { createClient } from "@/lib/supabase/client";

type BoardWorkspaceProps = {
  boardId: string;
  userLabel: string;
  userId: string;
};

type CursorPayload = {
  sessionId: string;
  userId: string;
  label: string;
  xNorm: number;
  yNorm: number;
  visible: boolean;
  color: string;
};

type Collaborator = {
  sessionId: string;
  label: string;
  userId: string;
};

function colorForUser(userId: string) {
  const colors = ["#38bdf8", "#f59e0b", "#22c55e", "#ef4444", "#a78bfa", "#14b8a6"];
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

export function BoardWorkspace({ boardId, userLabel, userId }: BoardWorkspaceProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const userColor = useMemo(() => colorForUser(userId), [userId]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, CursorPayload>>({});
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showRequestAccessModal, setShowRequestAccessModal] = useState(false);
  const [showCollaboratorList, setShowCollaboratorList] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const htmlCanvas = canvasRef.current;
    if (!wrapper || !htmlCanvas) return;

    const fabricCanvas = new Canvas(htmlCanvas, {
      selection: false,
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      renderOnAddRemove: true,
      stopContextMenu: true,
    });

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      const width = Math.max(rect.width, window.innerWidth);
      const height = Math.max(rect.height, window.innerHeight);
      fabricCanvas.setDimensions({
        width,
        height,
      });
      fabricCanvas.calcOffset();
      fabricCanvas.requestRenderAll();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    window.addEventListener("resize", resize);

    // Infinite-ish grid rendering based on viewport transform.
    const renderGrid = () => {
      const ctx = fabricCanvas.contextContainer;
      const vpt = fabricCanvas.viewportTransform;
      if (!ctx || !vpt) return;

      const width = fabricCanvas.getWidth();
      const height = fabricCanvas.getHeight();
      const zoom = fabricCanvas.getZoom();
      const tx = vpt[4];
      const ty = vpt[5];
      const step = 40;

      const leftWorld = -tx / zoom;
      const topWorld = -ty / zoom;
      const rightWorld = leftWorld + width / zoom;
      const bottomWorld = topWorld + height / zoom;
      const startX = Math.floor(leftWorld / step) * step;
      const startY = Math.floor(topWorld / step) * step;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 1;

      for (let x = startX; x <= rightWorld; x += step) {
        const sx = x * zoom + tx;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
      }
      for (let y = startY; y <= bottomWorld; y += step) {
        const sy = y * zoom + ty;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
        ctx.stroke();
      }
      ctx.restore();
    };

    fabricCanvas.on("after:render", renderGrid);

    // Pan + zoom interactions.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    fabricCanvas.defaultCursor = "grab";

    const onMouseDown = (event: { e: MouseEvent }) => {
      if (event.e.button !== 0) return;
      dragging = true;
      lastX = event.e.clientX;
      lastY = event.e.clientY;
      fabricCanvas.defaultCursor = "grabbing";
    };

    const onMouseMove = (event: { e: MouseEvent }) => {
      if (!dragging) return;
      const vpt = fabricCanvas.viewportTransform;
      if (!vpt) return;

      vpt[4] += event.e.clientX - lastX;
      vpt[5] += event.e.clientY - lastY;
      lastX = event.e.clientX;
      lastY = event.e.clientY;
      fabricCanvas.requestRenderAll();
    };

    const onMouseUp = () => {
      dragging = false;
      fabricCanvas.defaultCursor = "grab";
    };

    const onWheel = (event: { e: WheelEvent }) => {
      const delta = event.e.deltaY;
      let zoom = fabricCanvas.getZoom() * Math.pow(0.999, delta);
      zoom = Math.max(0.2, Math.min(4, zoom));

      fabricCanvas.zoomToPoint(new Point(event.e.offsetX, event.e.offsetY), zoom);
      event.e.preventDefault();
      event.e.stopPropagation();
      fabricCanvas.requestRenderAll();
    };

    fabricCanvas.on("mouse:down", onMouseDown);
    fabricCanvas.on("mouse:move", onMouseMove);
    fabricCanvas.on("mouse:up", onMouseUp);
    fabricCanvas.on("mouse:wheel", onWheel);

    // Realtime cursor sync and collaborator presence.
    const supabase = createClient();
    const channel = supabase.channel(`board:${boardId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: sessionId },
      },
    });

    channel
      .on("broadcast", { event: "cursor_move" }, ({ payload }) => {
        const incoming = payload as CursorPayload;
        if (!incoming?.sessionId || incoming.sessionId === sessionId) return;
        setRemoteCursors((prev) => {
          if (!incoming.visible) {
            const { [incoming.sessionId]: _removed, ...rest } = prev;
            return rest;
          }
          return { ...prev, [incoming.sessionId]: incoming };
        });
      })
      .on("presence", { event: "sync" }, () => {
        const presence = channel.presenceState() as Record<
          string,
          Array<{ label?: string; userId?: string; sessionId?: string }>
        >;

        const nextCollaborators: Collaborator[] = [];
        Object.entries(presence).forEach(([presenceKey, entries]) => {
          if (presenceKey === sessionId) return;
          const first = entries[0];
          nextCollaborators.push({
            sessionId: presenceKey,
            label: first?.label ?? "user",
            userId: first?.userId ?? "unknown",
          });
        });
        setCollaborators(nextCollaborators);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            sessionId,
            userId,
            label: userLabel,
          });
        }
      });

    let cursorTimer: number | null = null;
    const onPointerMove = (event: PointerEvent) => {
      const rect = wrapper.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      const payload: CursorPayload = {
        sessionId,
        userId,
        label: userLabel,
        xNorm: Math.max(0, Math.min(1, x / Math.max(rect.width, 1))),
        yNorm: Math.max(0, Math.min(1, y / Math.max(rect.height, 1))),
        visible: true,
        color: userColor,
      };

      if (cursorTimer) window.clearTimeout(cursorTimer);
      cursorTimer = window.setTimeout(() => {
        channel.send({
          type: "broadcast",
          event: "cursor_move",
          payload,
        });
      }, 24);
    };

    const onPointerLeave = () => {
      channel.send({
        type: "broadcast",
        event: "cursor_move",
        payload: {
          sessionId,
          userId,
          label: userLabel,
          xNorm: 0,
          yNorm: 0,
          visible: false,
          color: userColor,
        } satisfies CursorPayload,
      });
    };

    wrapper.addEventListener("pointermove", onPointerMove);
    wrapper.addEventListener("pointerleave", onPointerLeave);

    fabricCanvas.requestRenderAll();

    return () => {
      if (cursorTimer) window.clearTimeout(cursorTimer);
      wrapper.removeEventListener("pointermove", onPointerMove);
      wrapper.removeEventListener("pointerleave", onPointerLeave);
      channel.unsubscribe();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      fabricCanvas.off("after:render", renderGrid);
      fabricCanvas.off("mouse:down", onMouseDown);
      fabricCanvas.off("mouse:move", onMouseMove);
      fabricCanvas.off("mouse:up", onMouseUp);
      fabricCanvas.off("mouse:wheel", onWheel);
      fabricCanvas.dispose();
    };
  }, []);

  const visibleCollaborators = collaborators.slice(0, 3);
  const overflowCount = Math.max(collaborators.length - 3, 0);
  const shareLink =
    typeof window === "undefined" ? "" : `${window.location.origin}/board/${boardId}`;

  return (
    <div className="fixed inset-0 overflow-hidden bg-white">
      {/* top-left board header */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-3 rounded-xl border border-slate-300 bg-white/95 px-4 py-2 shadow-sm">
        <span className="font-semibold text-slate-900">CollabBoard</span>
        <span className="text-slate-400">|</span>
        <span className="text-sm text-slate-700">Board: {boardId}</span>
        <button
          type="button"
          onClick={() => setShowOptionsModal(true)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Options
        </button>
      </div>

      {/* board info/share/collaborators */}
      <div className="absolute left-4 top-20 z-20 w-[230px] rounded-xl border border-slate-300 bg-white/95 p-3 shadow-sm">
        <p className="text-sm text-slate-700">
          Board: <span className="font-medium text-slate-900">{boardId}</span>
        </p>
        <button
          type="button"
          onClick={() => setShowShareModal(true)}
          className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Share board
        </button>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-slate-600">Collaborators</span>
          <div className="flex items-center">
            {visibleCollaborators.map((collab, index) => (
              <div
                key={collab.sessionId}
                className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-white text-xs font-medium text-white"
                style={{
                  marginLeft: index === 0 ? 0 : -6,
                  backgroundColor: colorForUser(collab.userId),
                }}
                title={collab.label}
              >
                {collab.label.slice(0, 1).toUpperCase()}
              </div>
            ))}
            {overflowCount > 0 && (
              <button
                type="button"
                onClick={() => setShowCollaboratorList((prev) => !prev)}
                className="-ml-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-xs text-slate-700"
                title={`${overflowCount} more collaborators`}
              >
                +{overflowCount}
              </button>
            )}
          </div>
        </div>

        {showCollaboratorList && (
          <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
            {collaborators.length === 0 ? (
              <p>No collaborators connected.</p>
            ) : (
              <ul className="space-y-1">
                {collaborators.map((collab) => (
                  <li key={collab.sessionId}>{collab.label}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* top-right user controls */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-3 rounded-xl border border-slate-300 bg-white/95 px-3 py-2 shadow-sm">
        <span className="rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-700">
          {userLabel}
        </span>
        <button
          type="button"
          onClick={() => setShowRequestAccessModal(true)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Request edit access
        </button>
      </div>

      {/* side tool bar */}
      <div className="absolute bottom-4 left-4 top-[230px] z-20 w-16 rounded-xl border border-slate-300 bg-white/95">
        <div className="flex h-full flex-col items-center gap-2 p-2 text-xs text-slate-700">
          <button type="button" className="h-8 w-8 rounded border border-slate-300">
            ↖
          </button>
          <button type="button" className="h-8 w-8 rounded border border-slate-300">
            ✏
          </button>
          <button type="button" className="h-8 w-8 rounded border border-slate-300">
            T
          </button>
          <button type="button" className="h-8 w-8 rounded border border-slate-300">
            ▢
          </button>
        </div>
      </div>

      {/* canvas fills whole viewport area under overlays */}
      <div ref={wrapperRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {/* realtime remote cursors */}
      <div className="pointer-events-none absolute inset-0 z-30">
        {Object.values(remoteCursors).map((cursor) => (
          <div
            key={cursor.sessionId}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${cursor.xNorm * 100}%`,
              top: `${cursor.yNorm * 100}%`,
            }}
          >
            <div
              className="h-3.5 w-3.5 rounded-sm border border-white"
              style={{ backgroundColor: cursor.color }}
            />
            <span
              className="mt-1 inline-block rounded px-1.5 py-0.5 text-xs text-white"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.label}
            </span>
          </div>
        ))}
      </div>

      {showOptionsModal && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-24">
          <div className="w-[340px] rounded-xl border border-slate-300 bg-white p-4 shadow-lg">
            <h3 className="text-sm font-semibold text-slate-900">Board Options</h3>
            <p className="mt-2 text-sm text-slate-600">
              Placeholder for board settings and permissions.
            </p>
            <button
              type="button"
              onClick={() => setShowOptionsModal(false)}
              className="mt-4 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showShareModal && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-24">
          <div className="w-[420px] rounded-xl border border-slate-300 bg-white p-4 shadow-lg">
            <h3 className="text-sm font-semibold text-slate-900">Share Board</h3>
            <p className="mt-2 text-xs text-slate-600">Board ID</p>
            <input
              readOnly
              value={boardId}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <p className="mt-3 text-xs text-slate-600">Share link</p>
            <input
              readOnly
              value={shareLink}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(shareLink);
                }}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showRequestAccessModal && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/20 pt-24">
          <div className="w-[360px] rounded-xl border border-slate-300 bg-white p-4 shadow-lg">
            <h3 className="text-sm font-semibold text-slate-900">Request Edit Access</h3>
            <p className="mt-2 text-sm text-slate-600">
              Placeholder flow for requesting write permissions from board owner.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
                onClick={() => setShowRequestAccessModal(false)}
              >
                Send request
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
                onClick={() => setShowRequestAccessModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
