"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import ContextMenu from "@/components/ContextMenu";
import ConnectionPointModal from "@/components/ConnectionPointModal";
import { getBoards, markBoardVisited, sanitizeBoardId } from "@/lib/boards/store";
import {
  createBoardObject,
  createBoardObjectId,
  denormalizeBoardObjects,
  hitTestBoardObject,
  isDrawableTool,
  normalizeBoardObjects,
  removeBoardObjects,
  upsertBoardObject,
  type BoardObject,
  type BoardObjectType,
  type BoardStateNormalized,
  type ToolId,
  type WorldPoint,
} from "@/lib/boards/model";
import {
  createBoardEventsChannel,
  sendBoardRealtimeEvent,
  subscribeChannel,
  type BoardRealtimeEvent,
} from "@/lib/supabase/boardRealtime";
import { loadPersistedBoardSnapshot, savePersistedBoardSnapshot } from "@/lib/supabase/boardStateStore";

type BoardWorkspaceProps = {
  boardId: string;
  userLabel: string;
  userId: string;
};

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
  boardName?: string;
  worldX: number;
  worldY: number;
  sentAt: number;
};

type RemoteCursor = PresenceCursorPayload & {
  key: string;
  receivedAt: number;
};

type RemoteCollaborator = {
  key: string;
  userId: string;
  label: string;
  color: string;
  boardName?: string;
  lastActiveAt: number;
};

type CursorBroadcastPayload = {
  sessionId: string;
  userId: string;
  label: string;
  color: string;
  boardName?: string;
  worldX: number;
  worldY: number;
  sentAt: number;
};

type ObjectDragSnapshot = {
  ids: string[];
  origins: Record<string, { x: number; y: number; x2?: number; y2?: number }>;
  pointerWorldAtStart: WorldPoint;
  axisLock?: "none" | "horizontal" | "vertical" | "diagonal";
};

type ResizeHandle = "nw" | "ne" | "sw" | "se";
type ResizeSnapshot = {
  id: string;
  handle: ResizeHandle;
  origin: BoardObject;
  pointerWorldAtStart: WorldPoint;
};

type RotateSnapshot = {
  id: string;
  origin: BoardObject;
  center: WorldPoint;
  pointerStartAngle: number;
  originRotation: number;
};

type ConnectAnchor = "top" | "right" | "bottom" | "left";
type ConnectSnapshot = {
  sourceId: string;
  anchor: ConnectAnchor;
  fromPoint: WorldPoint;
  toPoint: WorldPoint;
};

type LineConnectorType = "arrow" | "simple";

type LineStartPoint = {
  point: WorldPoint;
  objectId?: string;
  anchor?: ConnectAnchor;
};

type MarqueeSelection = {
  start: WorldPoint;
  end: WorldPoint;
};

type FrameDraft = {
  start: WorldPoint;
  end: WorldPoint;
};

type FrameDeletePrompt = {
  frameId: string;
  childIds: string[];
};

type EphemeralRealtimeEvent =
  | {
      type: "object_update";
      sessionId: string;
      userId: string;
      sentAt: number;
      object: Partial<BoardObject> & Pick<BoardObject, "id">;
    }
  | {
      type: "selection_changed";
      sessionId: string;
      userId: string;
      label: string;
      color: string;
      selectedIds: string[];
      sentAt: number;
    };

type RemoteSelection = {
  key: string;
  userId: string;
  label: string;
  color: string;
  selectedIds: string[];
  sentAt: number;
};

type RotationTooltip = {
  left: number;
  top: number;
  degrees: number;
};

type DragConstraintGuide = {
  from: WorldPoint;
  to: WorldPoint;
};

declare global {
  interface Window {
    __collabboardPerf?: {
      seedObjects: (count: number) => number;
      clearObjects: () => void;
      setMockCollaborators: (count: number) => number;
      clearMockCollaborators: () => void;
      getMetrics: () => { objectCount: number; selectedCount: number };
    };
  }
}

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 64;
const BASE_DOT_SPACING = 56;
const MIN_SCREEN_DOT_SPACING = 14;
const CURSOR_BROADCAST_MIN_INTERVAL_MS = 50;
const CURSOR_STALE_TIMEOUT_MS = 10_000;
const CURSOR_HEARTBEAT_INTERVAL_MS = 2000;
const OBJECT_BROADCAST_MIN_INTERVAL_MS = 30;
const EPHEMERAL_OBJECT_BROADCAST_MIN_INTERVAL_MS = 30;
const PERSIST_DEBOUNCE_MS = 350;
const SNAPSHOT_RECONCILE_INTERVAL_MS = 5000;
const MIN_TEXT_FONT_SIZE = 12;
const MAX_TEXT_FONT_SIZE = 72;
const MIN_FRAME_SIZE = 80;
const CONNECTION_POINT_RADIUS_PX = 6;
const LINE_SNAP_RADIUS_PX = 22;
const COLOR_PALETTE = ["#0f172a", "#ef4444", "#f59e0b", "#84cc16", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"];
const INITIAL_BOARD_STATE: BoardStateNormalized = { order: [], objects: {} };
const RESIZE_HANDLE_SIZE_PX = 10;
const CONNECTOR_DOT_SIZE_PX = 10;
const TOOLBAR_ITEMS: Array<{ id: ToolId; icon: string; description: string }> = [
  { id: "hand", icon: "✋", description: "Hand (drag board)" },
  { id: "cursor", icon: "", description: "Cursor (select objects)" },
  { id: "frame", icon: "", description: "Frame" },
  { id: "sticky", icon: "🗒️", description: "Sticky note" },
  { id: "rectangle", icon: "▭", description: "Rectangle" },
  { id: "circle", icon: "◯", description: "Circle" },
  { id: "line", icon: "", description: "Line" },
  { id: "text", icon: "T", description: "Text" },
];

function colorFromUserId(userId: string) {
  const colors = [
    "#a855f7",
    "#f97316",
    "#ef4444",
    "#3b82f6",
    "#10b981",
    "#ec4899",
    "#06b6d4",
    "#f59e0b",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

function readBoardNameFromCatalog(boardId: string) {
  if (typeof window === "undefined") return "";
  const cleanId = sanitizeBoardId(boardId);
  try {
    const raw = window.localStorage.getItem("collabboard.boardCatalog.v1");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Record<string, { name?: string }>;
    const value = parsed?.[cleanId]?.name;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function clampTextFontSize(value: number) {
  return Math.max(MIN_TEXT_FONT_SIZE, Math.min(MAX_TEXT_FONT_SIZE, value));
}

export function BoardWorkspaceV2({ boardId, userLabel, userId }: BoardWorkspaceProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, pixelRatio: 1 });
  const viewportRef = useRef<Viewport>({ x: 600, y: 360, zoom: 1 });
  const isPanningRef = useRef(false);
  const dragPointerIdRef = useRef<number | null>(null);
  const panOriginRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const objectDragRef = useRef<ObjectDragSnapshot | null>(null);
  const resizeRef = useRef<ResizeSnapshot | null>(null);
  const rotateRef = useRef<RotateSnapshot | null>(null);
  const connectRef = useRef<ConnectSnapshot | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const isLoadedFromStoreRef = useRef(false);
  const lastObjectBroadcastAtRef = useRef<Record<string, number>>({});

  const [signingOut, setSigningOut] = useState(false);
  const [viewport, setViewport] = useState<Viewport>({ x: 600, y: 360, zoom: 1 });
  const [activeTool, setActiveTool] = useState<ToolId>("cursor");
  const [isPanning, setIsPanning] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [remoteCollaborators, setRemoteCollaborators] = useState<Record<string, RemoteCollaborator>>({});
  const [boardState, setBoardState] = useState<BoardStateNormalized>(INITIAL_BOARD_STATE);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [lastRemoteCursorLatencyMs, setLastRemoteCursorLatencyMs] = useState<number | null>(null);
  const [lastRemoteObjectLatencyMs, setLastRemoteObjectLatencyMs] = useState<number | null>(null);
  const [boardName, setBoardName] = useState("");
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelection | null>(null);
  const [inlineTextEdit, setInlineTextEdit] = useState<{ id: string; value: string } | null>(null);
  const [connectDraft, setConnectDraft] = useState<ConnectSnapshot | null>(null);
  const [frameDraft, setFrameDraft] = useState<FrameDraft | null>(null);
  const [frameDeletePrompt, setFrameDeletePrompt] = useState<FrameDeletePrompt | null>(null);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [clipboard, setClipboard] = useState<BoardObject[]>([]);
  const [canvasMousePos, setCanvasMousePos] = useState<WorldPoint>({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [rotationTooltip, setRotationTooltip] = useState<RotationTooltip | null>(null);
  const [dragConstraintGuide, setDragConstraintGuide] = useState<DragConstraintGuide | null>(null);
  const [remoteSelections, setRemoteSelections] = useState<Record<string, RemoteSelection>>({});
  const [mockCollaborators, setMockCollaborators] = useState<Record<string, RemoteCollaborator>>({});
  const [lineToolActive, setLineToolActive] = useState(false);
  const [lineType, setLineType] = useState<LineConnectorType | null>(null);
  const [showLineTypeModal, setShowLineTypeModal] = useState(false);
  const [showLineInfo, setShowLineInfo] = useState(false);
  const [lineStartPoint, setLineStartPoint] = useState<LineStartPoint | null>(null);
  const [connectionPointModal, setConnectionPointModal] = useState<{
    x: number;
    y: number;
    start: LineStartPoint;
  } | null>(null);
  const [hoveredConnectionAnchor, setHoveredConnectionAnchor] = useState<ConnectAnchor | null>(null);

  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const eventChannelRef = useRef<RealtimeChannel | null>(null);
  const ephemeralChannelRef = useRef<RealtimeChannel | null>(null);
  const sessionIdRef = useRef(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const lastCursorSentAtRef = useRef(0);
  const boardStateRef = useRef<BoardStateNormalized>(INITIAL_BOARD_STATE);
  const selectedIdsRef = useRef<string[]>([]);
  const remoteCursorsRef = useRef<Record<string, RemoteCursor>>({});
  const boardNameRef = useRef("Untitled Board");
  const activeToolRef = useRef<ToolId>("cursor");
  const lastSnapshotAppliedAtRef = useRef(0);
  const lastCursorWorldRef = useRef<WorldPoint>({ x: 0, y: 0 });
  const isSpacePressedRef = useRef(false);
  const previousToolBeforeSpaceRef = useRef<ToolId>("cursor");
  const lastEphemeralObjectBroadcastAtRef = useRef<Record<string, number>>({});
  const lastSnapshotRequestAtRef = useRef(0);

  const userColor = colorFromUserId(userId || "user");
  const debugLog = (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[board-sync]", ...args);
    }
  };

  const requestStateSnapshot = (reason: string) => {
    const channel = eventChannelRef.current;
    if (!channel || !realtimeReady) return;
    const now = Date.now();
    if (now - lastSnapshotRequestAtRef.current < 350) return;
    lastSnapshotRequestAtRef.current = now;
    debugLog("snapshot request", { reason, boardId, sessionId: sessionIdRef.current });
    void sendBoardRealtimeEvent(channel, {
      type: "snapshot_request",
      sessionId: sessionIdRef.current,
      sentAt: now,
      requesterSessionId: sessionIdRef.current,
    });
  };

  const userInitial = (userLabel || "U").trim().charAt(0).toUpperCase() || "U";
  const canvasCursor =
    activeTool === "hand"
      ? isPanning
        ? "grabbing"
        : "grab"
      : activeTool === "cursor"
        ? "default"
        : activeTool === "text"
          ? "text"
          : "crosshair";

  const drawBoard = (
    nextViewport: Viewport,
    nextState: BoardStateNormalized,
    nextSelectedIds: string[],
    nextRemoteCursors: Record<string, RemoteCursor>,
  ) => {
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
    const spacingMultiplier = Math.max(1, Math.ceil(MIN_SCREEN_DOT_SPACING / Math.max(baseScreenSpacing, 0.0001)));
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

    const drawOrder = [
      ...nextState.order.filter((id) => nextState.objects[id]?.type === "frame"),
      ...nextState.order.filter((id) => nextState.objects[id]?.type !== "frame"),
    ];

    for (const id of drawOrder) {
      const object = nextState.objects[id];
      if (!object) continue;
      const selected = nextSelectedIds.includes(object.id);
      const rotation = object.rotation ?? 0;
      const centerX = object.x + object.width / 2;
      const centerY = object.y + object.height / 2;
      context.save();
      context.lineWidth = Math.max(1, 2 / nextViewport.zoom);
      context.strokeStyle = selected ? "#0f172a" : "rgba(15, 23, 42, 0.45)";

      if (object.type === "frame") {
        context.translate(centerX, centerY);
        context.rotate(rotation);
        context.fillStyle = object.color || "rgba(200, 200, 200, 0.1)";
        context.fillRect(-object.width / 2, -object.height / 2, object.width, object.height);
        context.strokeStyle = selected ? "#2563eb" : "rgba(51, 65, 85, 0.65)";
        context.setLineDash([8 / nextViewport.zoom, 6 / nextViewport.zoom]);
        context.strokeRect(-object.width / 2, -object.height / 2, object.width, object.height);
        context.setLineDash([]);
        context.fillStyle = "#334155";
        context.font = `${Math.max(11, 12 / Math.max(nextViewport.zoom, 0.8))}px Arial, sans-serif`;
        context.textBaseline = "top";
        context.fillText(object.text?.trim() || "Frame", -object.width / 2 + 8, -object.height / 2 + 6);
      } else if (object.type === "sticky") {
        context.translate(centerX, centerY);
        context.rotate(rotation);
        context.fillStyle = object.color;
        context.fillRect(-object.width / 2, -object.height / 2, object.width, object.height);
        context.strokeRect(-object.width / 2, -object.height / 2, object.width, object.height);
        context.fillStyle = "#0f172a";
        context.font = `${Math.max(12, 16 / Math.max(nextViewport.zoom, 0.8))}px sans-serif`;
        context.textBaseline = "top";
        if (object.text) {
          context.fillText(object.text.slice(0, 60), -object.width / 2 + 10, -object.height / 2 + 10, object.width - 20);
        }
      } else if (object.type === "rectangle") {
        context.translate(centerX, centerY);
        context.rotate(rotation);
        context.fillStyle = object.color;
        context.fillRect(-object.width / 2, -object.height / 2, object.width, object.height);
        context.strokeRect(-object.width / 2, -object.height / 2, object.width, object.height);
      } else if (object.type === "circle") {
        context.translate(centerX, centerY);
        context.rotate(rotation);
        context.beginPath();
        context.ellipse(
          0,
          0,
          object.width / 2,
          object.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        context.fillStyle = object.color;
        context.fill();
        context.stroke();
      } else if (object.type === "line") {
        const x2 = object.x2 ?? object.x + object.width;
        const y2 = object.y2 ?? object.y;
        context.beginPath();
        context.moveTo(object.x, object.y);
        context.lineTo(x2, y2);
        context.strokeStyle = object.color;
        context.lineWidth = Math.max(2, 3 / nextViewport.zoom);
        context.stroke();
        if (object.lineStyle === "arrow") {
          const angle = Math.atan2(y2 - object.y, x2 - object.x);
          const arrowLength = Math.max(10, 16 / Math.max(nextViewport.zoom, 0.8));
          const arrowWidth = Math.max(6, 10 / Math.max(nextViewport.zoom, 0.8));
          context.beginPath();
          context.moveTo(x2, y2);
          context.lineTo(
            x2 - arrowLength * Math.cos(angle) + arrowWidth * Math.sin(angle),
            y2 - arrowLength * Math.sin(angle) - arrowWidth * Math.cos(angle),
          );
          context.lineTo(
            x2 - arrowLength * Math.cos(angle) - arrowWidth * Math.sin(angle),
            y2 - arrowLength * Math.sin(angle) + arrowWidth * Math.cos(angle),
          );
          context.closePath();
          context.fillStyle = object.color;
          context.fill();
        }
      } else if (object.type === "text") {
        context.translate(centerX, centerY);
        context.rotate(rotation);
        context.fillStyle = object.color;
        context.font = `${clampTextFontSize(object.fontSize ?? 16)}px Arial, sans-serif`;
        context.textBaseline = "top";
        context.fillText(object.text || "Text", -object.width / 2, -object.height / 2, object.width);
      }

      context.restore();
    }
    context.restore();

    if (Object.keys(nextRemoteCursors).length > 0) {
      context.save();
      context.fillStyle = "rgba(15, 23, 42, 0.82)";
      context.font = "13px sans-serif";
      context.fillText(`Live cursors: ${Object.keys(nextRemoteCursors).length}`, 22, 22);
      context.restore();
    }
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
      drawBoard(viewportRef.current, boardStateRef.current, selectedIdsRef.current, remoteCursorsRef.current);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewportRef.current = viewport;
    boardStateRef.current = boardState;
    selectedIdsRef.current = selectedObjectIds;
    remoteCursorsRef.current = remoteCursors;
    boardNameRef.current = boardName || "Untitled Board";
    activeToolRef.current = activeTool;
    drawBoard(viewport, boardState, selectedObjectIds, remoteCursors);
  }, [viewport, boardState, selectedObjectIds, remoteCursors, boardName, activeTool]);

  useEffect(() => {
    markBoardVisited(boardId, userId);
  }, [boardId, userId]);

  useEffect(() => {
    debugLog("canvas mounted", {
      boardId,
      userId,
      userLabel,
      sessionId: sessionIdRef.current,
    });
  }, [boardId, userId, userLabel]);

  useEffect(() => {
    let cancelled = false;
    const redirectToLogin = () => {
      router.replace(`/login?redirect=${encodeURIComponent(`/board/${boardId}`)}`);
    };

    const initializeRealtimeAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
        setRealtimeReady(true);
      } else {
        setRealtimeReady(false);
        redirectToLogin();
      }
    };

    void initializeRealtimeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      supabase.realtime.setAuth(session?.access_token ?? "");
      if (cancelled) return;
      if (event === "SIGNED_OUT" || !session) {
        setRealtimeReady(false);
        redirectToLogin();
      } else {
        setRealtimeReady(true);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [boardId, router, supabase]);

  useEffect(() => {
    const refreshBoardName = () => {
      const cleanId = sanitizeBoardId(boardId);
      const entry = getBoards(userId).find((board) => board.id === cleanId);
      const fromBoards = entry?.name?.trim() || "";
      const fromCatalog = readBoardNameFromCatalog(cleanId);
      const nextName = fromBoards || fromCatalog || boardNameRef.current || "Untitled Board";
      setBoardName(nextName);
      if (fromBoards || fromCatalog) {
        schedulePersistence(boardStateRef.current, nextName);
      }
    };

    refreshBoardName();
    window.addEventListener("focus", refreshBoardName);
    window.addEventListener("collabboard:boards-updated", refreshBoardName);
    window.addEventListener("storage", refreshBoardName);
    return () => {
      window.removeEventListener("focus", refreshBoardName);
      window.removeEventListener("collabboard:boards-updated", refreshBoardName);
      window.removeEventListener("storage", refreshBoardName);
    };
  }, [boardId, userId]);

  const schedulePersistence = (nextState: BoardStateNormalized, nextBoardName?: string) => {
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    const snapshot = denormalizeBoardObjects(nextState);
    const resolvedName = (nextBoardName ?? boardNameRef.current ?? "").trim();
    const boardNameToPersist = resolvedName && resolvedName !== "Untitled Board" ? resolvedName : undefined;
    persistTimerRef.current = window.setTimeout(() => {
      void savePersistedBoardSnapshot(supabase, boardId, {
        objects: snapshot,
        boardName: boardNameToPersist,
      });
      persistTimerRef.current = null;
    }, PERSIST_DEBOUNCE_MS);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snapshot = await loadPersistedBoardSnapshot(supabase, boardId);
      if (cancelled) return;
      isLoadedFromStoreRef.current = true;
      setBoardState(normalizeBoardObjects(snapshot.objects));
      if (snapshot.boardName?.trim()) {
        setBoardName(snapshot.boardName.trim());
      }
    })();
    return () => {
      cancelled = true;
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [boardId, supabase]);

  const applyRemoteEvent = (event: BoardRealtimeEvent) => {
    if (event.type === "snapshot_request") {
      if (event.requesterSessionId === sessionIdRef.current || event.sessionId === sessionIdRef.current) {
        return;
      }
      const channel = eventChannelRef.current;
      if (!channel) return;
      const objects = denormalizeBoardObjects(boardStateRef.current);
      void sendBoardRealtimeEvent(channel, {
        type: "snapshot_response",
        sessionId: sessionIdRef.current,
        sentAt: Date.now(),
        targetSessionId: event.requesterSessionId,
        objects,
        boardName: boardNameRef.current,
      });
      return;
    }

    if (event.type === "snapshot_response") {
      if (event.targetSessionId !== sessionIdRef.current || event.sessionId === sessionIdRef.current) return;
      if (event.sentAt <= lastSnapshotAppliedAtRef.current) return;
      lastSnapshotAppliedAtRef.current = event.sentAt;
      setBoardState((current) => {
        if (event.objects.length === 0) return current;
        if (current.order.length === 0) {
          const normalized = normalizeBoardObjects(event.objects);
          schedulePersistence(normalized, event.boardName);
          return normalized;
        }

        let merged = current;
        for (const incoming of event.objects) {
          const existing = merged.objects[incoming.id];
          if (existing && existing.updatedAt > incoming.updatedAt) continue;
          merged = upsertBoardObject(merged, incoming);
        }
        if (merged !== current) {
          schedulePersistence(merged, event.boardName);
        }
        return merged;
      });
      if (event.boardName?.trim() && boardNameRef.current === "Untitled Board") {
        setBoardName(event.boardName.trim());
      }
      return;
    }

    if (event.sessionId === sessionIdRef.current) return;
    if (event.type === "cursor_move") {
      const key = `${event.userId}:${event.sessionId}`;
      const now = Date.now();
      const latency = Math.max(0, now - event.sentAt);
      setLastRemoteCursorLatencyMs(latency);
      setRemoteCollaborators((current) => ({
        ...current,
        [key]: {
          key,
          userId: event.userId,
          label: event.label,
          color: event.color,
          boardName: event.boardName,
          lastActiveAt: event.sentAt,
        },
      }));
      setRemoteCursors((current) => ({
        ...current,
        [key]: {
          key,
          sessionId: event.sessionId,
          userId: event.userId,
          label: event.label,
          color: event.color,
          boardName: event.boardName,
          worldX: event.worldX,
          worldY: event.worldY,
          sentAt: event.sentAt,
          receivedAt: now,
        },
      }));
      if (event.boardName && boardNameRef.current === "Untitled Board") {
        setBoardName(event.boardName);
        schedulePersistence(boardStateRef.current, event.boardName);
      }
      return;
    }

    if (event.type === "upsert_object") {
      const latency = Math.max(0, Date.now() - event.sentAt);
      setLastRemoteObjectLatencyMs(latency);
      setBoardState((current) => {
        const existing = current.objects[event.object.id];
        if (existing && existing.updatedAt > event.object.updatedAt) return current;
        const next = upsertBoardObject(current, event.object);
        schedulePersistence(next);
        return next;
      });
      return;
    }

    const latency = Math.max(0, Date.now() - event.sentAt);
    setLastRemoteObjectLatencyMs(latency);
    setBoardState((current) => {
      const deletableIds = event.ids.filter((id) => {
        const existing = current.objects[id];
        return !existing || existing.updatedAt <= event.updatedAt;
      });
      if (deletableIds.length === 0) return current;
      const next = removeBoardObjects(current, deletableIds);
      schedulePersistence(next);
      return next;
    });
    setSelectedObjectIds((current) => current.filter((id) => !event.ids.includes(id)));
  };

  useEffect(() => {
    if (!realtimeReady) return;
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
      const nextCollaborators: Record<string, RemoteCollaborator> = {};
      const state = channel.presenceState<PresenceCursorPayload>();
      for (const key of Object.keys(state)) {
        const metas = state[key] ?? [];
        const newest = metas[metas.length - 1];
        if (!newest || newest.sessionId === sessionIdRef.current) continue;
        nextCollaborators[key] = {
          key,
          userId: newest.userId,
          label: newest.label,
          color: newest.color,
          boardName: newest.boardName,
          lastActiveAt: newest.sentAt,
        };
        setLastRemoteCursorLatencyMs(Math.max(0, now - newest.sentAt));
        if (newest.boardName && boardNameRef.current === "Untitled Board") {
          setBoardName(newest.boardName);
          schedulePersistence(boardStateRef.current, newest.boardName);
        }
        next[key] = { key, ...newest, receivedAt: now };
      }
      setRemoteCollaborators(nextCollaborators);
      setRemoteCursors(next);
      debugLog("presence sync", {
        collaborators: Object.keys(nextCollaborators).length + 1,
        remoteKeys: Object.keys(nextCollaborators),
      });
      if (Object.keys(nextCollaborators).length > 0) {
        requestStateSnapshot("presence-sync");
      }
    };

    channel.on("presence", { event: "sync" }, syncRemoteCursors);
    channel.on("presence", { event: "join" }, syncRemoteCursors);
    channel.on("presence", { event: "leave" }, syncRemoteCursors);
    channel.subscribe(async (status) => {
      debugLog("presence status", status);
      if (status !== "SUBSCRIBED") return;
      await channel.track({
        sessionId: sessionIdRef.current,
        userId,
        label: userLabel,
        color: userColor,
        boardName: boardNameRef.current,
        worldX: 0,
        worldY: 0,
        sentAt: Date.now(),
      } satisfies PresenceCursorPayload);
      broadcastCursorHeartbeat();
      requestStateSnapshot("presence-subscribed");
    });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      if (presenceChannelRef.current === channel) presenceChannelRef.current = null;
      setRemoteCursors({});
      setRemoteCollaborators({});
    };
  }, [boardId, realtimeReady, supabase, userColor, userId, userLabel]);

  useEffect(() => {
    if (!realtimeReady) return;
    const channel = presenceChannelRef.current;
    if (!channel) return;
    void channel.track({
      sessionId: sessionIdRef.current,
      userId,
      label: userLabel,
      color: userColor,
      boardName: boardNameRef.current,
      worldX: 0,
      worldY: 0,
      sentAt: Date.now(),
    } satisfies PresenceCursorPayload);
  }, [boardName, realtimeReady, userColor, userId, userLabel]);

  useEffect(() => {
    if (!realtimeReady) return;
    const timer = window.setInterval(() => {
      broadcastCursorHeartbeat();
    }, CURSOR_HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [boardName, realtimeReady, userColor, userId, userLabel]);

  useEffect(() => {
    if (!realtimeReady) return;
    const channel = createBoardEventsChannel(supabase, boardId, applyRemoteEvent);
    eventChannelRef.current = channel;
    let cancelled = false;
    void (async () => {
      await subscribeChannel(channel);
      debugLog("events status", "SUBSCRIBED");
      if (cancelled) return;
      requestStateSnapshot("events-subscribed");
    })();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (eventChannelRef.current === channel) eventChannelRef.current = null;
    };
  }, [boardId, realtimeReady, supabase]);

  useEffect(() => {
    if (!realtimeReady) return;
    const channel = supabase.channel(`board:${boardId}:ephemeral`);
    ephemeralChannelRef.current = channel;

    channel.on("broadcast", { event: "object_update" }, ({ payload }) => {
      const event = payload as EphemeralRealtimeEvent;
      if (event.type !== "object_update") return;
      if (event.sessionId === sessionIdRef.current) return;

      const incoming = event.object;
      setBoardState((current) => {
        const existing = current.objects[incoming.id];
        if (!existing) return current;
        const merged: BoardObject = {
          ...existing,
          ...incoming,
        };
        return upsertBoardObject(current, merged);
      });
    });

    channel.on("broadcast", { event: "selection_changed" }, ({ payload }) => {
      const event = payload as EphemeralRealtimeEvent;
      if (event.type !== "selection_changed") return;
      if (event.sessionId === sessionIdRef.current) return;
      const key = `${event.userId}:${event.sessionId}`;
      if (event.selectedIds.length === 0) {
        setRemoteSelections((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        return;
      }
      setRemoteSelections((current) => ({
        ...current,
        [key]: {
          key,
          userId: event.userId,
          label: event.label,
          color: event.color,
          selectedIds: event.selectedIds,
          sentAt: event.sentAt,
        },
      }));
    });

    void channel.subscribe((status) => {
      debugLog("ephemeral status", status);
    });
    return () => {
      supabase.removeChannel(channel);
      if (ephemeralChannelRef.current === channel) ephemeralChannelRef.current = null;
      setRemoteSelections({});
    };
  }, [boardId, realtimeReady, supabase]);

  useEffect(() => {
    if (!realtimeReady) return;
    const timer = window.setInterval(() => {
      requestStateSnapshot("periodic-reconcile");
    }, SNAPSHOT_RECONCILE_INTERVAL_MS);
    const onFocus = () => requestStateSnapshot("window-focus");
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [realtimeReady]);

  useEffect(() => {
    const channel = ephemeralChannelRef.current;
    if (!channel || !realtimeReady) return;
    const payload: EphemeralRealtimeEvent = {
      type: "selection_changed",
      sessionId: sessionIdRef.current,
      userId,
      label: userLabel,
      color: userColor,
      selectedIds: selectedObjectIds,
      sentAt: Date.now(),
    };
    void channel.send({
      type: "broadcast",
      event: "selection_changed",
      payload,
    });
  }, [selectedObjectIds, realtimeReady, userColor, userId, userLabel]);

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
      return {
        x: screenX - worldX * nextZoom,
        y: screenY - worldY * nextZoom,
        zoom: nextZoom,
      };
    });
  };

  const worldFromScreen = (screenX: number, screenY: number): WorldPoint => ({
    x: (screenX - viewportRef.current.x) / viewportRef.current.zoom,
    y: (screenY - viewportRef.current.y) / viewportRef.current.zoom,
  });

  const updateCanvasMousePos = (screenX: number, screenY: number) => {
    setCanvasMousePos(worldFromScreen(screenX, screenY));
  };

  const screenFromWorld = (point: WorldPoint) => ({
    x: viewport.x + point.x * viewport.zoom,
    y: viewport.y + point.y * viewport.zoom,
  });

  const objectCenter = (object: BoardObject): WorldPoint => ({
    x: object.x + object.width / 2,
    y: object.y + object.height / 2,
  });

  const objectBounds = (object: BoardObject) => ({
    left: object.x,
    top: object.y,
    right: object.x + object.width,
    bottom: object.y + object.height,
    width: object.width,
    height: object.height,
  });

  const lineMidpoint = (object: BoardObject): WorldPoint => {
    const x2 = object.x2 ?? object.x + object.width;
    const y2 = object.y2 ?? object.y;
    return { x: (object.x + x2) / 2, y: (object.y + y2) / 2 };
  };

  const frameIdsByZOrder = () =>
    boardStateRef.current.order.filter((id) => {
      const object = boardStateRef.current.objects[id];
      return object?.type === "frame";
    });

  const pointInsideObjectBounds = (object: BoardObject, point: WorldPoint) => {
    const bounds = objectBounds(object);
    return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
  };

  const findContainingFrameId = (point: WorldPoint, skipObjectId?: string) => {
    const frameIds = frameIdsByZOrder();
    for (let i = frameIds.length - 1; i >= 0; i -= 1) {
      const frame = boardStateRef.current.objects[frameIds[i]];
      if (!frame || frame.id === skipObjectId) continue;
      if (pointInsideObjectBounds(frame, point)) return frame.id;
    }
    return undefined;
  };

  const connectorPoint = (object: BoardObject, anchor: ConnectAnchor): WorldPoint => {
    if (object.type === "line") {
      const x2 = object.x2 ?? object.x + object.width;
      const y2 = object.y2 ?? object.y;
      const left = Math.min(object.x, x2);
      const right = Math.max(object.x, x2);
      const top = Math.min(object.y, y2);
      const bottom = Math.max(object.y, y2);
      if (anchor === "top") return { x: (left + right) / 2, y: top };
      if (anchor === "right") return { x: right, y: (top + bottom) / 2 };
      if (anchor === "bottom") return { x: (left + right) / 2, y: bottom };
      return { x: left, y: (top + bottom) / 2 };
    }
    const bounds = objectBounds(object);
    if (anchor === "top") return { x: (bounds.left + bounds.right) / 2, y: bounds.top };
    if (anchor === "right") return { x: bounds.right, y: (bounds.top + bounds.bottom) / 2 };
    if (anchor === "bottom") return { x: (bounds.left + bounds.right) / 2, y: bounds.bottom };
    return { x: bounds.left, y: (bounds.top + bounds.bottom) / 2 };
  };

  const nearestAnchor = (object: BoardObject, point: WorldPoint): ConnectAnchor => {
    const anchors: ConnectAnchor[] = ["top", "right", "bottom", "left"];
    let best: ConnectAnchor = "right";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const anchor of anchors) {
      const candidate = connectorPoint(object, anchor);
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance < bestDistance) {
        best = anchor;
        bestDistance = distance;
      }
    }
    return best;
  };

  const objectSnapPoint = (object: BoardObject): WorldPoint => {
    if (object.type === "line") return lineMidpoint(object);
    return objectCenter(object);
  };

  const connectionPointsForObject = (object: BoardObject): Array<{ anchor: ConnectAnchor; point: WorldPoint }> => [
    { anchor: "top", point: connectorPoint(object, "top") },
    { anchor: "right", point: connectorPoint(object, "right") },
    { anchor: "bottom", point: connectorPoint(object, "bottom") },
    { anchor: "left", point: connectorPoint(object, "left") },
  ];

  const constrainDelta = (deltaX: number, deltaY: number, axisLock: ObjectDragSnapshot["axisLock"]) => {
    if (!axisLock || axisLock === "none") {
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (absX >= absY * 1.5) axisLock = "horizontal";
      else if (absY >= absX * 1.5) axisLock = "vertical";
      else axisLock = "diagonal";
    }
    if (axisLock === "horizontal") return { deltaX, deltaY: 0, axisLock };
    if (axisLock === "vertical") return { deltaX: 0, deltaY, axisLock };
    const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    return { deltaX: Math.sign(deltaX || 1) * magnitude, deltaY: Math.sign(deltaY || 1) * magnitude, axisLock };
  };

  const maybeTrackCursor = (screenX: number, screenY: number) => {
    if (!realtimeReady) return;
    const now = Date.now();
    if (now - lastCursorSentAtRef.current < CURSOR_BROADCAST_MIN_INTERVAL_MS) return;
    const channel = presenceChannelRef.current;
    if (!channel) return;
    lastCursorSentAtRef.current = now;
    const point = worldFromScreen(screenX, screenY);
    const payload: CursorBroadcastPayload = {
      sessionId: sessionIdRef.current,
      userId,
      label: userLabel,
      color: userColor,
      boardName: boardNameRef.current,
      worldX: point.x,
      worldY: point.y,
      sentAt: now,
    };
    lastCursorWorldRef.current = { x: payload.worldX, y: payload.worldY };
    channel.track(payload satisfies PresenceCursorPayload);
    const eventChannel = eventChannelRef.current;
    if (eventChannel) {
      void sendBoardRealtimeEvent(eventChannel, {
        type: "cursor_move",
        sessionId: payload.sessionId,
        sentAt: payload.sentAt,
        userId: payload.userId,
        label: payload.label,
        color: payload.color,
        boardName: payload.boardName,
        worldX: payload.worldX,
        worldY: payload.worldY,
      });
    }
  };

  const broadcastCursorHeartbeat = () => {
    if (!realtimeReady) return;
    const channel = eventChannelRef.current;
    if (!channel) return;
    const sentAt = Date.now();
    const point = lastCursorWorldRef.current;
    void sendBoardRealtimeEvent(channel, {
      type: "cursor_move",
      sessionId: sessionIdRef.current,
      sentAt,
      userId,
      label: userLabel,
      color: userColor,
      boardName: boardNameRef.current,
      worldX: point.x,
      worldY: point.y,
    });
  };

  const getObjectAtPoint = (point: WorldPoint) => {
    for (let i = boardStateRef.current.order.length - 1; i >= 0; i -= 1) {
      const id = boardStateRef.current.order[i];
      const object = boardStateRef.current.objects[id];
      if (!object || object.type === "frame") continue;
      if (hitTestBoardObject(object, point)) return object;
    }

    for (let i = boardStateRef.current.order.length - 1; i >= 0; i -= 1) {
      const id = boardStateRef.current.order[i];
      const object = boardStateRef.current.objects[id];
      if (!object) continue;
      if (hitTestBoardObject(object, point)) return object;
    }
    return null;
  };

  const broadcastUpsert = (object: BoardObject, throttled = false) => {
    const channel = eventChannelRef.current;
    if (!channel) return;
    const now = Date.now();
    if (throttled) {
      const last = lastObjectBroadcastAtRef.current[object.id] ?? 0;
      if (now - last < OBJECT_BROADCAST_MIN_INTERVAL_MS) return;
    }
    lastObjectBroadcastAtRef.current[object.id] = now;
    void sendBoardRealtimeEvent(channel, {
      type: "upsert_object",
      sessionId: sessionIdRef.current,
      sentAt: now,
      object,
    });
  };

  const broadcastDelete = (ids: string[], updatedAt: number) => {
    const channel = eventChannelRef.current;
    if (!channel || ids.length === 0) return;
    void sendBoardRealtimeEvent(channel, {
      type: "delete_objects",
      sessionId: sessionIdRef.current,
      sentAt: Date.now(),
      ids,
      updatedAt,
    });
  };

  const broadcastEphemeralObjectUpdate = (object: BoardObject) => {
    const channel = ephemeralChannelRef.current;
    if (!channel) return;
    const now = Date.now();
    const last = lastEphemeralObjectBroadcastAtRef.current[object.id] ?? 0;
    if (now - last < EPHEMERAL_OBJECT_BROADCAST_MIN_INTERVAL_MS) return;
    lastEphemeralObjectBroadcastAtRef.current[object.id] = now;
    const payload: EphemeralRealtimeEvent = {
      type: "object_update",
      sessionId: sessionIdRef.current,
      userId,
      sentAt: now,
      object: {
        id: object.id,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        x2: object.x2,
        y2: object.y2,
        rotation: object.rotation,
      },
    };
    void channel.send({
      type: "broadcast",
      event: "object_update",
      payload,
    });
  };

  const upsertLocalObject = (object: BoardObject, options?: { broadcast?: boolean; throttledBroadcast?: boolean }) => {
    setBoardState((current) => {
      const next = upsertBoardObject(current, object);
      schedulePersistence(next);
      return next;
    });
    if (options?.broadcast) {
      broadcastUpsert(object, options.throttledBroadcast ?? false);
      if (options.throttledBroadcast) {
        broadcastEphemeralObjectUpdate(object);
      }
    }
  };

  const removeLocalObjectsById = (ids: string[], withBroadcast = true) => {
    if (ids.length === 0) return;
    const now = Date.now();
    setBoardState((current) => {
      const next = removeBoardObjects(current, ids);
      schedulePersistence(next);
      return next;
    });
    setSelectedObjectIds((current) => current.filter((id) => !ids.includes(id)));
    if (withBroadcast) broadcastDelete(ids, now);
  };

  const duplicateObjects = (ids: string[], offset = 20) => {
    const now = Date.now();
    const next: BoardObject[] = [];
    for (const id of ids) {
      const source = boardStateRef.current.objects[id];
      if (!source) continue;
      const cloned: BoardObject = {
        ...source,
        id: createBoardObjectId(),
        x: source.x + offset,
        y: source.y + offset,
        x2: typeof source.x2 === "number" ? source.x2 + offset : source.x2,
        y2: typeof source.y2 === "number" ? source.y2 + offset : source.y2,
        createdAt: now,
        updatedAt: now,
        updatedBy: userId,
      };
      next.push(cloned);
    }
    if (next.length === 0) return;
    setBoardState((current) => {
      let state = current;
      for (const item of next) {
        state = upsertBoardObject(state, item);
      }
      schedulePersistence(state);
      return state;
    });
    setSelectedObjectIds(next.map((item) => item.id));
    for (const item of next) {
      broadcastUpsert(item, false);
    }
  };

  const handleCopy = () => {
    const selected = selectedIdsRef.current
      .map((id) => boardStateRef.current.objects[id])
      .filter((value): value is BoardObject => Boolean(value))
      .map((item) => ({ ...item }));
    if (selected.length === 0) return;
    setClipboard(selected);
    if (process.env.NODE_ENV !== "production") {
      console.log("📋 Copied", selected.length, "object(s)");
    }
  };

  const handleDelete = () => {
    const ids = [...selectedIdsRef.current];
    if (ids.length === 0) return;
    if (ids.length === 1) {
      const maybeFrame = boardStateRef.current.objects[ids[0]];
      if (maybeFrame?.type === "frame") {
        const childIds = Object.values(boardStateRef.current.objects)
          .filter((object) => object.parentFrameId === maybeFrame.id)
          .map((object) => object.id);
        if (childIds.length > 0) {
          setFrameDeletePrompt({ frameId: maybeFrame.id, childIds });
          return;
        }
      }
    }
    removeLocalObjectsById(ids, true);
    if (process.env.NODE_ENV !== "production") {
      console.log("🗑️ Deleted", ids.length, "object(s)");
    }
  };

  const handleDeleteFrameOnly = () => {
    if (!frameDeletePrompt) return;
    const frame = boardStateRef.current.objects[frameDeletePrompt.frameId];
    if (!frame) {
      setFrameDeletePrompt(null);
      return;
    }

    const detached = frameDeletePrompt.childIds
      .map((id) => boardStateRef.current.objects[id])
      .filter((value): value is BoardObject => Boolean(value))
      .map((object) => ({
        ...object,
        parentFrameId: undefined,
        updatedAt: Date.now(),
        updatedBy: userId,
      }));

    if (detached.length > 0) {
      setBoardState((current) => {
        let next = current;
        for (const object of detached) {
          next = upsertBoardObject(next, object);
        }
        schedulePersistence(next);
        return next;
      });
      for (const object of detached) {
        broadcastUpsert(object, false);
      }
    }

    removeLocalObjectsById([frameDeletePrompt.frameId], true);
    setFrameDeletePrompt(null);
  };

  const handleDeleteFrameAndContents = () => {
    if (!frameDeletePrompt) return;
    removeLocalObjectsById([frameDeletePrompt.frameId, ...frameDeletePrompt.childIds], true);
    setFrameDeletePrompt(null);
  };

  const handleCut = () => {
    const ids = [...selectedIdsRef.current];
    if (ids.length === 0) return;
    handleCopy();
    removeLocalObjectsById(ids, true);
    if (process.env.NODE_ENV !== "production") {
      console.log("✂️ Cut", ids.length, "object(s)");
    }
  };

  const handlePaste = () => {
    if (clipboard.length === 0) return;
    const minLeft = Math.min(...clipboard.map((item) => objectBounds(item).left));
    const minTop = Math.min(...clipboard.map((item) => objectBounds(item).top));
    const maxRight = Math.max(...clipboard.map((item) => objectBounds(item).right));
    const maxBottom = Math.max(...clipboard.map((item) => objectBounds(item).bottom));
    const groupCenterX = (minLeft + maxRight) / 2;
    const groupCenterY = (minTop + maxBottom) / 2;
    const offsetX = canvasMousePos.x - groupCenterX;
    const offsetY = canvasMousePos.y - groupCenterY;

    const now = Date.now();
    const pasted = clipboard.map((item) => ({
      ...item,
      id: createBoardObjectId(),
      x: item.x + offsetX,
      y: item.y + offsetY,
      x2: typeof item.x2 === "number" ? item.x2 + offsetX : item.x2,
      y2: typeof item.y2 === "number" ? item.y2 + offsetY : item.y2,
      createdAt: now,
      updatedAt: now,
      updatedBy: userId,
    }));

    setBoardState((current) => {
      let next = current;
      for (const item of pasted) {
        next = upsertBoardObject(next, item);
      }
      schedulePersistence(next);
      return next;
    });
    setSelectedObjectIds(pasted.map((item) => item.id));
    selectedIdsRef.current = pasted.map((item) => item.id);
    for (const item of pasted) {
      broadcastUpsert(item, false);
    }
    if (process.env.NODE_ENV !== "production") {
      console.log("📌 Pasted", pasted.length, "object(s) at cursor position");
    }
  };

  const handleDuplicate = () => {
    const ids = [...selectedIdsRef.current];
    if (ids.length === 0) return;
    duplicateObjects(ids, 20);
    if (process.env.NODE_ENV !== "production") {
      console.log("🔄 Duplicated", ids.length, "object(s)");
    }
  };

  const createConnectorLine = (
    from: LineStartPoint,
    to: LineStartPoint,
    connectorType: LineConnectorType,
  ) => {
    const now = Date.now();
    const fromPoint = from.point;
    const toPoint = to.point;
    const line: BoardObject = {
      id: createBoardObjectId(),
      type: "line",
      x: fromPoint.x,
      y: fromPoint.y,
      x2: toPoint.x,
      y2: toPoint.y,
      width: Math.max(1, Math.abs(toPoint.x - fromPoint.x)),
      height: Math.max(1, Math.abs(toPoint.y - fromPoint.y)),
      rotation: 0,
      color: "#111827",
      createdAt: now,
      updatedAt: now,
      updatedBy: userId,
      lineStyle: connectorType,
      startObjectId: from.objectId,
      endObjectId: to.objectId,
      startAnchor: from.anchor,
      endAnchor: to.anchor,
    };
    upsertLocalObject(line, { broadcast: true });
    setSelectedObjectIds([line.id]);
  };

  const resetLineCreationMode = () => {
    setLineToolActive(false);
    setLineType(null);
    setLineStartPoint(null);
    setConnectDraft(null);
    setActiveTool("cursor");
  };

  const beginLineFromStart = (start: LineStartPoint, type: LineConnectorType) => {
    setLineType(type);
    setLineToolActive(true);
    setLineStartPoint(start);
    setActiveTool("line");
    setConnectDraft({
      sourceId: start.objectId ?? "",
      anchor: start.anchor ?? "right",
      fromPoint: start.point,
      toPoint: start.point,
    });
  };

  const resolveLineSnapTarget = (point: WorldPoint, hit: BoardObject | null): LineStartPoint => {
    if (!hit) {
      return { point };
    }
    if (hit.type === "line") {
      return { point: lineMidpoint(hit), objectId: hit.id };
    }
    const anchor = nearestAnchor(hit, point);
    return { point: connectorPoint(hit, anchor), objectId: hit.id, anchor };
  };

  const findNearbyLineSnapTarget = (point: WorldPoint, options?: { excludeObjectId?: string }) => {
    const thresholdWorld = LINE_SNAP_RADIUS_PX / Math.max(viewportRef.current.zoom, 0.01);
    let bestDistance = thresholdWorld;
    let best: LineStartPoint | null = null;

    for (let i = boardStateRef.current.order.length - 1; i >= 0; i -= 1) {
      const id = boardStateRef.current.order[i];
      const object = boardStateRef.current.objects[id];
      if (!object || object.id === options?.excludeObjectId) continue;
      if (object.type === "frame") continue;

      if (object.type === "line") {
        const mid = lineMidpoint(object);
        const distance = Math.hypot(mid.x - point.x, mid.y - point.y);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { point: mid, objectId: object.id };
        }
        continue;
      }

      const anchor = nearestAnchor(object, point);
      const anchorPoint = connectorPoint(object, anchor);
      const distance = Math.hypot(anchorPoint.x - point.x, anchorPoint.y - point.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { point: anchorPoint, objectId: object.id, anchor };
      }
    }

    return best;
  };

  const resolveLineSnapTargetWithMagnet = (
    point: WorldPoint,
    hit: BoardObject | null,
    options?: { excludeObjectId?: string },
  ) => {
    if (hit && hit.id !== options?.excludeObjectId && hit.type !== "frame") {
      return resolveLineSnapTarget(point, hit);
    }
    return findNearbyLineSnapTarget(point, options) ?? { point };
  };

  const commitLineClick = (point: WorldPoint) => {
    if (!lineToolActive || !lineType) return false;
    const hit = getObjectAtPoint(point);
    const target = resolveLineSnapTargetWithMagnet(point, hit, {
      excludeObjectId: lineStartPoint?.objectId,
    });
    if (!lineStartPoint) {
      setLineStartPoint(target);
      setConnectDraft({
        sourceId: target.objectId ?? "",
        anchor: target.anchor ?? "right",
        fromPoint: target.point,
        toPoint: target.point,
      });
      return true;
    }
    createConnectorLine(lineStartPoint, target, lineType);
    resetLineCreationMode();
    return true;
  };

  const syncConnectedLinesForObjectIds = (objectIds: string[]) => {
    if (objectIds.length === 0) return;
    const touched = new Set(objectIds);
    const lines = boardStateRef.current.order
      .map((id) => boardStateRef.current.objects[id])
      .filter((value): value is BoardObject => Boolean(value))
      .filter((object) => object.type === "line");

    for (const line of lines) {
      const startTouched = line.startObjectId ? touched.has(line.startObjectId) : false;
      const endTouched = line.endObjectId ? touched.has(line.endObjectId) : false;
      if (!startTouched && !endTouched) continue;

      let x1 = line.x;
      let y1 = line.y;
      let x2 = line.x2 ?? line.x + line.width;
      let y2 = line.y2 ?? line.y;

      if (line.startObjectId) {
        const startObject = boardStateRef.current.objects[line.startObjectId];
        if (startObject) {
          const startPoint = line.startAnchor ? connectorPoint(startObject, line.startAnchor) : objectSnapPoint(startObject);
          x1 = startPoint.x;
          y1 = startPoint.y;
        }
      }
      if (line.endObjectId) {
        const endObject = boardStateRef.current.objects[line.endObjectId];
        if (endObject) {
          const endPoint = line.endAnchor ? connectorPoint(endObject, line.endAnchor) : objectSnapPoint(endObject);
          x2 = endPoint.x;
          y2 = endPoint.y;
        }
      }

      const nextLine: BoardObject = {
        ...line,
        x: x1,
        y: y1,
        x2,
        y2,
        width: Math.max(1, Math.abs(x2 - x1)),
        height: Math.max(1, Math.abs(y2 - y1)),
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      upsertLocalObject(nextLine, { broadcast: true, throttledBroadcast: true });
    }
  };

  const commitInlineTextEdit = () => {
    if (!inlineTextEdit) return;
    const object = boardStateRef.current.objects[inlineTextEdit.id];
    if (!object) {
      setInlineTextEdit(null);
      return;
    }
    upsertLocalObject(
      {
        ...object,
        text: inlineTextEdit.value,
        updatedAt: Date.now(),
        updatedBy: userId,
      },
      { broadcast: true },
    );
    setInlineTextEdit(null);
  };

  const handleCanvasPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (process.env.NODE_ENV !== "production") {
      console.log("mousedown", event.target);
    }
    setContextMenu(null);
    updateCanvasMousePos(event.clientX, event.clientY);
    maybeTrackCursor(event.clientX, event.clientY);
    commitInlineTextEdit();
    const point = worldFromScreen(event.clientX, event.clientY);

    if (lineToolActive && lineType) {
      const handled = commitLineClick(point);
      if (handled) {
        return;
      }
    }

    if (activeTool === "frame") {
      setFrameDraft({ start: point, end: point });
      dragPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (activeTool === "hand") {
      isPanningRef.current = true;
      dragPointerIdRef.current = event.pointerId;
      panOriginRef.current = {
        x: event.clientX,
        y: event.clientY,
        startX: viewportRef.current.x,
        startY: viewportRef.current.y,
      };
      setIsPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (activeTool === "cursor") {
      const hit = getObjectAtPoint(point);
      if (!hit) {
        if (!event.shiftKey) {
          selectedIdsRef.current = [];
          setSelectedObjectIds([]);
          setActiveTool("cursor");
        }
        setMarqueeSelection({ start: point, end: point });
        dragPointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      const nextSelected = event.shiftKey
        ? selectedIdsRef.current.includes(hit.id)
          ? selectedIdsRef.current.filter((id) => id !== hit.id)
          : [...selectedIdsRef.current, hit.id]
        : selectedIdsRef.current.includes(hit.id)
          ? selectedIdsRef.current
          : [hit.id];
      setSelectedObjectIds(nextSelected);

      const selectedBase = nextSelected.includes(hit.id) ? nextSelected : [hit.id];
      const selectedFrameIds = selectedBase.filter((id) => boardStateRef.current.objects[id]?.type === "frame");
      const childIds = Object.values(boardStateRef.current.objects)
        .filter((object) => object.parentFrameId && selectedFrameIds.includes(object.parentFrameId))
        .map((object) => object.id);
      const movingIds = Array.from(new Set([...selectedBase, ...childIds]));
      const origins: ObjectDragSnapshot["origins"] = {};
      for (const id of movingIds) {
        const object = boardStateRef.current.objects[id];
        if (!object) continue;
        origins[id] = { x: object.x, y: object.y, x2: object.x2, y2: object.y2 };
      }
      objectDragRef.current = {
        ids: movingIds,
        origins,
        pointerWorldAtStart: point,
        axisLock: "none",
      };
      dragPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (isDrawableTool(activeTool)) {
      if (activeTool === "line") {
        if (!lineToolActive && !showLineTypeModal && !showLineInfo) {
          setShowLineTypeModal(true);
        }
        return;
      }
      if (activeTool === "text") {
        const created = createBoardObject(activeTool, point, userId);
        upsertLocalObject(created, { broadcast: true });
        setSelectedObjectIds([created.id]);
        setInlineTextEdit({ id: created.id, value: created.text ?? "Text" });
        setActiveTool("cursor");
        return;
      }

      const created = createBoardObject(activeTool, point, userId);
      upsertLocalObject(created, { broadcast: true });
      setSelectedObjectIds([created.id]);
      // Shape and text tools are single-shot: create once, then return to selection.
      setActiveTool("cursor");
    }
  };

  const handleCanvasPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    updateCanvasMousePos(event.clientX, event.clientY);
    maybeTrackCursor(event.clientX, event.clientY);
    const currentPoint = worldFromScreen(event.clientX, event.clientY);

    if (lineToolActive && lineStartPoint) {
      const hoverHit = getObjectAtPoint(currentPoint);
      const snappedTarget = resolveLineSnapTargetWithMagnet(currentPoint, hoverHit, {
        excludeObjectId: lineStartPoint.objectId,
      });
      setConnectDraft((current) =>
        current
          ? {
              ...current,
              toPoint: snappedTarget.point,
            }
          : {
              sourceId: lineStartPoint.objectId ?? "",
              anchor: lineStartPoint.anchor ?? "right",
              fromPoint: lineStartPoint.point,
              toPoint: snappedTarget.point,
            },
      );
    }

    if (frameDraft && dragPointerIdRef.current === event.pointerId) {
      setFrameDraft((current) => (current ? { ...current, end: currentPoint } : current));
      return;
    }

    if (marqueeSelection && dragPointerIdRef.current === event.pointerId) {
      setMarqueeSelection((current) => (current ? { ...current, end: currentPoint } : current));
      return;
    }

    if (resizeRef.current && dragPointerIdRef.current === event.pointerId) {
      const { origin, pointerWorldAtStart, handle } = resizeRef.current;
      const deltaX = currentPoint.x - pointerWorldAtStart.x;
      const deltaY = currentPoint.y - pointerWorldAtStart.y;
      if (origin.type === "text") {
        const baseFontSize = clampTextFontSize(origin.fontSize ?? 16);
        const minScale = MIN_TEXT_FONT_SIZE / baseFontSize;
        const maxScale = MAX_TEXT_FONT_SIZE / baseFontSize;
        const widthScale = Math.max(0.1, Math.abs((origin.width + (handle.includes("w") ? -deltaX : deltaX)) / origin.width));
        const heightScale = Math.max(
          0.1,
          Math.abs((origin.height + (handle.includes("n") ? -deltaY : deltaY)) / origin.height),
        );
        const scale = Math.max(minScale, Math.min(maxScale, Math.max(widthScale, heightScale)));
        const width = Math.max(40, origin.width * scale);
        const height = Math.max(20, origin.height * scale);
        const right = origin.x + origin.width;
        const bottom = origin.y + origin.height;
        const x = handle.includes("w") ? right - width : origin.x;
        const y = handle.includes("n") ? bottom - height : origin.y;

        const resizedText: BoardObject = {
          ...origin,
          x,
          y,
          width,
          height,
          fontSize: clampTextFontSize(baseFontSize * scale),
          updatedAt: Date.now(),
          updatedBy: userId,
        };
        upsertLocalObject(resizedText, { broadcast: true, throttledBroadcast: true });
        syncConnectedLinesForObjectIds([resizedText.id]);
        return;
      }

      const minSize = 24;
      let x = origin.x;
      let y = origin.y;
      let width = origin.width;
      let height = origin.height;
      if (handle === "nw") {
        x = origin.x + deltaX;
        y = origin.y + deltaY;
        width = origin.width - deltaX;
        height = origin.height - deltaY;
      } else if (handle === "ne") {
        y = origin.y + deltaY;
        width = origin.width + deltaX;
        height = origin.height - deltaY;
      } else if (handle === "sw") {
        x = origin.x + deltaX;
        width = origin.width - deltaX;
        height = origin.height + deltaY;
      } else if (handle === "se") {
        width = origin.width + deltaX;
        height = origin.height + deltaY;
      }
      width = Math.max(minSize, width);
      height = Math.max(minSize, height);
      const resized: BoardObject = {
        ...origin,
        x,
        y,
        width,
        height,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      upsertLocalObject(resized, { broadcast: true, throttledBroadcast: true });
      syncConnectedLinesForObjectIds([resized.id]);
      return;
    }

    if (rotateRef.current && dragPointerIdRef.current === event.pointerId) {
      const { id, center, pointerStartAngle, originRotation } = rotateRef.current;
      const object = boardStateRef.current.objects[id];
      if (!object) return;
      const angle = Math.atan2(currentPoint.y - center.y, currentPoint.x - center.x);
      const rawRotation = originRotation + (angle - pointerStartAngle);
      const snapStep = Math.PI / 12;
      const snappedRotation = event.shiftKey ? Math.round(rawRotation / snapStep) * snapStep : rawRotation;
      const rotated: BoardObject = {
        ...object,
        rotation: snappedRotation,
        updatedAt: Date.now(),
        updatedBy: userId,
      };
      upsertLocalObject(rotated, { broadcast: true, throttledBroadcast: true });
      syncConnectedLinesForObjectIds([rotated.id]);
      const screenCenter = screenFromWorld(center);
      const degrees = ((snappedRotation * 180) / Math.PI) % 360;
      setRotationTooltip({
        left: screenCenter.x + 12,
        top: screenCenter.y - 34,
        degrees: degrees < 0 ? degrees + 360 : degrees,
      });
      return;
    }

    if (connectRef.current && dragPointerIdRef.current === event.pointerId) {
      const nextConnect = { ...connectRef.current, toPoint: currentPoint };
      connectRef.current = nextConnect;
      setConnectDraft(nextConnect);
      return;
    }

    if (activeTool === "hand") {
      if (!isPanningRef.current || dragPointerIdRef.current !== event.pointerId || !panOriginRef.current) return;
      const nextX = panOriginRef.current.startX + (event.clientX - panOriginRef.current.x);
      const nextY = panOriginRef.current.startY + (event.clientY - panOriginRef.current.y);
      setViewport((current) => ({ ...current, x: nextX, y: nextY }));
      return;
    }

    if (activeTool !== "cursor" || dragPointerIdRef.current !== event.pointerId || !objectDragRef.current) return;
    const drag = objectDragRef.current;
    let deltaX = currentPoint.x - drag.pointerWorldAtStart.x;
    let deltaY = currentPoint.y - drag.pointerWorldAtStart.y;
    if (event.shiftKey) {
      const constrained = constrainDelta(deltaX, deltaY, drag.axisLock);
      deltaX = constrained.deltaX;
      deltaY = constrained.deltaY;
      objectDragRef.current = { ...drag, axisLock: constrained.axisLock };
      setDragConstraintGuide({
        from: drag.pointerWorldAtStart,
        to: {
          x: drag.pointerWorldAtStart.x + deltaX,
          y: drag.pointerWorldAtStart.y + deltaY,
        },
      });
    } else if (drag.axisLock !== "none") {
      objectDragRef.current = { ...drag, axisLock: "none" };
      setDragConstraintGuide(null);
    } else {
      setDragConstraintGuide(null);
    }

    for (const id of drag.ids) {
      const object = boardStateRef.current.objects[id];
      const origin = drag.origins[id];
      if (!object || !origin) continue;
      upsertLocalObject(
        {
          ...object,
          x: origin.x + deltaX,
          y: origin.y + deltaY,
          x2: typeof origin.x2 === "number" ? origin.x2 + deltaX : object.x2,
          y2: typeof origin.y2 === "number" ? origin.y2 + deltaY : object.y2,
          updatedAt: Date.now(),
          updatedBy: userId,
        },
        { broadcast: true, throttledBroadcast: true },
      );
    }
    syncConnectedLinesForObjectIds(drag.ids);
  };

  const stopDragging = () => {
    isPanningRef.current = false;
    dragPointerIdRef.current = null;
    panOriginRef.current = null;
    objectDragRef.current = null;
    resizeRef.current = null;
    rotateRef.current = null;
    connectRef.current = null;
    setConnectDraft(null);
    setFrameDraft(null);
    setRotationTooltip(null);
    setDragConstraintGuide(null);
    setIsPanning(false);
  };

  const clearSelectionState = (options?: { resetTool?: boolean }) => {
    selectedIdsRef.current = [];
    setSelectedObjectIds([]);
    setMarqueeSelection(null);
    if (options?.resetTool) {
      setActiveTool("cursor");
    }
  };

  const finalizePointerInteraction = (source: "canvas" | "resize-handle") => {
    const wasResizing = Boolean(resizeRef.current);
    stopDragging();
    if (wasResizing) {
      // Equivalent of discardActiveObject + render for our state-based canvas.
      clearSelectionState({ resetTool: true });
    }
    if (process.env.NODE_ENV !== "production") {
      console.log("mouseup", source, { activeObjectIds: selectedIdsRef.current });
    }
  };

  const handleCanvasPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    updateCanvasMousePos(event.clientX, event.clientY);
    maybeTrackCursor(event.clientX, event.clientY);
    const point = worldFromScreen(event.clientX, event.clientY);
    if (dragPointerIdRef.current !== event.pointerId) return;

    if (frameDraft) {
      const left = Math.min(frameDraft.start.x, frameDraft.end.x);
      const top = Math.min(frameDraft.start.y, frameDraft.end.y);
      const width = Math.max(MIN_FRAME_SIZE, Math.abs(frameDraft.end.x - frameDraft.start.x));
      const height = Math.max(MIN_FRAME_SIZE, Math.abs(frameDraft.end.y - frameDraft.start.y));
      const now = Date.now();
      const frame: BoardObject = {
        id: createBoardObjectId(),
        type: "frame",
        x: left,
        y: top,
        width,
        height,
        rotation: 0,
        color: "rgba(200, 200, 200, 0.1)",
        text: "Frame",
        createdAt: now,
        updatedAt: now,
        updatedBy: userId,
      };
      upsertLocalObject(frame, { broadcast: true });
      setSelectedObjectIds([frame.id]);
      setFrameDraft(null);
      setActiveTool("cursor");
      finalizePointerInteraction("canvas");
      return;
    }

    const dragSnapshot = objectDragRef.current;
    if (dragSnapshot) {
      const movedIds = dragSnapshot.ids;
      const movedFrameIds = movedIds.filter((id) => boardStateRef.current.objects[id]?.type === "frame");
      const changed: BoardObject[] = [];
      for (const id of movedIds) {
        const object = boardStateRef.current.objects[id];
        if (!object || object.type === "frame") continue;
        // Children moved with a selected frame should keep current parent assignment.
        if (object.parentFrameId && movedFrameIds.includes(object.parentFrameId)) continue;
        const center = { x: object.x + object.width / 2, y: object.y + object.height / 2 };
        const nextParentFrameId = findContainingFrameId(center, object.id);
        if (nextParentFrameId !== object.parentFrameId) {
          changed.push({
            ...object,
            parentFrameId: nextParentFrameId,
            updatedAt: Date.now(),
            updatedBy: userId,
          });
        }
      }

      if (changed.length > 0) {
        setBoardState((current) => {
          let next = current;
          for (const object of changed) {
            next = upsertBoardObject(next, object);
          }
          schedulePersistence(next);
          return next;
        });
        for (const object of changed) {
          broadcastUpsert(object, false);
        }
      }

      // Send final authoritative object state at pointer release.
      for (const id of movedIds) {
        const moved = boardStateRef.current.objects[id];
        if (!moved) continue;
        broadcastUpsert(moved, false);
      }
    }

    if (marqueeSelection) {
      const left = Math.min(marqueeSelection.start.x, marqueeSelection.end.x);
      const right = Math.max(marqueeSelection.start.x, marqueeSelection.end.x);
      const top = Math.min(marqueeSelection.start.y, marqueeSelection.end.y);
      const bottom = Math.max(marqueeSelection.start.y, marqueeSelection.end.y);
      const selected = boardStateRef.current.order.filter((id) => {
        const object = boardStateRef.current.objects[id];
        if (!object) return false;
        const bounds = objectBounds(object);
        return bounds.left < right && bounds.right > left && bounds.top < bottom && bounds.bottom > top;
      });
      setSelectedObjectIds(selected);
      setMarqueeSelection(null);
    }

    if (connectRef.current) {
      const target = getObjectAtPoint(point);
      const source = boardStateRef.current.objects[connectRef.current.sourceId];
      if (target && source && target.id !== source.id) {
        const toAnchor = nearestAnchor(target, point);
        const targetPoint = connectorPoint(target, toAnchor);
        createConnectorLine(
          {
            point: connectRef.current.fromPoint,
            objectId: source.id,
            anchor: connectRef.current.anchor,
          },
          {
            point: targetPoint,
            objectId: target.id,
            anchor: toAnchor,
          },
          lineType ?? "arrow",
        );
      }
      connectRef.current = null;
      setConnectDraft(null);
    }
    finalizePointerInteraction("canvas");
  };

  const handleCanvasWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    zoomAtScreenPoint(pointerX, pointerY, event.deltaY > 0 ? 0.92 : 1.08);
  };

  const handleCanvasContextMenu = (event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    updateCanvasMousePos(event.clientX, event.clientY);
    if (selectedIdsRef.current.length === 0) return;
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const zoomFromButtons = (direction: "in" | "out") => {
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;
    zoomAtScreenPoint(width / 2, height / 2, direction === "in" ? 1.15 : 1 / 1.15);
  };

  const resetZoomToDefault = () => {
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;
    setViewport((current) => {
      const nextZoom = 1;
      const worldCenterX = (width / 2 - current.x) / current.zoom;
      const worldCenterY = (height / 2 - current.y) / current.zoom;
      return {
        x: width / 2 - worldCenterX * nextZoom,
        y: height / 2 - worldCenterY * nextZoom,
        zoom: nextZoom,
      };
    });
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    const client = createClient();
    await client.auth.signOut();
    router.replace("/");
    router.refresh();
    setSigningOut(false);
  };

  const copyBoardId = async () => {
    try {
      await navigator.clipboard.writeText(boardId);
    } catch {
      // ignore clipboard write failures
    }
  };

  const selectedObjects = selectedObjectIds
    .map((id) => boardState.objects[id])
    .filter((value): value is BoardObject => Boolean(value));
  const hasSelectedColorTarget = selectedObjects.length > 0;
  const effectiveRemoteCollaborators = { ...remoteCollaborators, ...mockCollaborators };
  const uniqueOtherCollaborators = Array.from(
    Object.values(effectiveRemoteCollaborators).reduce((acc, collaborator) => {
      if (!collaborator.userId || collaborator.userId === userId) return acc;
      const existing = acc.get(collaborator.userId);
      if (!existing || collaborator.lastActiveAt > existing.lastActiveAt) {
        acc.set(collaborator.userId, collaborator);
      }
      return acc;
    }, new Map<string, RemoteCollaborator>()),
  )
    .map(([, collaborator]) => collaborator)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const otherCollaborators = uniqueOtherCollaborators.filter(
    (collaborator) => collaborator.userId && collaborator.userId !== userId,
  );
  const selfCollaborator: RemoteCollaborator = {
    key: `self:${userId}`,
    userId,
    label: userLabel || "You",
    color: userColor,
    boardName: boardNameRef.current,
    lastActiveAt: Number.MAX_SAFE_INTEGER,
  };
  const allCollaboratorsForDisplay = [selfCollaborator, ...otherCollaborators];
  const displayedCollaborators = allCollaboratorsForDisplay.slice(0, 3);
  const overflowCollaboratorCount = Math.max(0, allCollaboratorsForDisplay.length - displayedCollaborators.length);
  const totalOnlineCount = allCollaboratorsForDisplay.length;
  const dedupedRemoteCursors = Array.from(
    Object.values(remoteCursors).reduce((acc, cursor) => {
      // Keep only the newest cursor for each remote user to avoid duplicate cursor ghosts.
      const existing = acc.get(cursor.userId);
      if (!existing || cursor.sentAt >= existing.sentAt) {
        acc.set(cursor.userId, cursor);
      }
      return acc;
    }, new Map<string, RemoteCursor>()),
  ).map(([, cursor]) => cursor);
  const primarySelectedObject = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const selectedOverlayItems =
    primarySelectedObject && primarySelectedObject.type !== "line"
      ? (() => {
          const bounds = objectBounds(primarySelectedObject);
          return [
            {
              id: primarySelectedObject.id,
              left: viewport.x + bounds.left * viewport.zoom,
              top: viewport.y + bounds.top * viewport.zoom,
              width: bounds.width * viewport.zoom,
              height: bounds.height * viewport.zoom,
            },
          ];
        })()
      : [];
  const selectedConnectionPoints =
    primarySelectedObject
      ? connectionPointsForObject(primarySelectedObject).map(({ anchor, point }) => ({
          anchor,
          point,
          left: viewport.x + point.x * viewport.zoom,
          top: viewport.y + point.y * viewport.zoom,
        }))
      : [];
  const frameChildHighlightItems =
    primarySelectedObject?.type === "frame"
      ? boardState.order
          .map((id) => boardState.objects[id])
          .filter((value): value is BoardObject => Boolean(value))
          .filter((object) => object.parentFrameId === primarySelectedObject.id)
          .map((object) => {
            const bounds = objectBounds(object);
            return {
              id: object.id,
              left: viewport.x + bounds.left * viewport.zoom,
              top: viewport.y + bounds.top * viewport.zoom,
              width: bounds.width * viewport.zoom,
              height: bounds.height * viewport.zoom,
            };
          })
      : [];
  const remoteSelectionOverlayItems = Object.values(remoteSelections).flatMap((remoteSelection) =>
    remoteSelection.selectedIds
      .map((id) => boardState.objects[id])
      .filter((value): value is BoardObject => Boolean(value))
      .map((object) => {
        const bounds = objectBounds(object);
        return {
          key: `${remoteSelection.key}:${object.id}`,
          color: remoteSelection.color,
          label: remoteSelection.label,
          left: viewport.x + bounds.left * viewport.zoom,
          top: viewport.y + bounds.top * viewport.zoom,
          width: bounds.width * viewport.zoom,
          height: bounds.height * viewport.zoom,
        };
      }),
  );
  const contextMenuPosition =
    selectedOverlayItems.length > 0
      ? {
          left: selectedOverlayItems[0].left + selectedOverlayItems[0].width + 14,
          top: Math.max(16, selectedOverlayItems[0].top - 6),
        }
      : null;

  const handleConnectionPointClick = (
    event: PointerEvent<HTMLButtonElement>,
    anchor: ConnectAnchor,
    point: WorldPoint,
  ) => {
    if (!primarySelectedObject) return;
    event.preventDefault();
    event.stopPropagation();

    const start: LineStartPoint = {
      point,
      objectId: primarySelectedObject.id,
      anchor,
    };

    if (!lineToolActive) {
      setConnectionPointModal({
        x: event.clientX,
        y: event.clientY,
        start,
      });
      return;
    }

    if (lineToolActive && lineType) {
      if (!lineStartPoint) {
        setLineStartPoint(start);
        setConnectDraft({
          sourceId: primarySelectedObject.id,
          anchor,
          fromPoint: point,
          toPoint: point,
        });
        return;
      }
      createConnectorLine(lineStartPoint, start, lineType);
      resetLineCreationMode();
    }
  };

  const startResize = (event: PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    if (!primarySelectedObject) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      id: primarySelectedObject.id,
      handle,
      origin: { ...primarySelectedObject },
      pointerWorldAtStart: worldFromScreen(event.clientX, event.clientY),
    };
    dragPointerIdRef.current = event.pointerId;
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const startRotate = (event: PointerEvent<HTMLButtonElement>) => {
    if (!primarySelectedObject) return;
    event.preventDefault();
    event.stopPropagation();
    const center = objectCenter(primarySelectedObject);
    const pointer = worldFromScreen(event.clientX, event.clientY);
    rotateRef.current = {
      id: primarySelectedObject.id,
      origin: { ...primarySelectedObject },
      center,
      pointerStartAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
      originRotation: primarySelectedObject.rotation ?? 0,
    };
    dragPointerIdRef.current = event.pointerId;
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const startConnector = (event: PointerEvent<HTMLButtonElement>, objectId: string, anchor: ConnectAnchor) => {
    const sourceObject = boardStateRef.current.objects[objectId];
    if (!sourceObject || sourceObject.type === "line") return;
    event.preventDefault();
    event.stopPropagation();
    const fromPoint = connectorPoint(sourceObject, anchor);
    connectRef.current = {
      sourceId: sourceObject.id,
      anchor,
      fromPoint,
      toPoint: fromPoint,
    };
    setConnectDraft(connectRef.current);
    dragPointerIdRef.current = event.pointerId;
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const applyColorToSelected = (color: string) => {
    const now = Date.now();
    for (const object of selectedObjects) {
      upsertLocalObject(
        {
          ...object,
          color,
          updatedAt: now,
          updatedBy: userId,
        },
        { broadcast: true },
      );
    }
  };

  const handleCanvasDoubleClick = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = worldFromScreen(event.clientX, event.clientY);
    const hit = getObjectAtPoint(point);
    if (!hit) return;
    if (hit.type === "frame") {
      const bounds = objectBounds(hit);
      const inLabelArea =
        point.x >= bounds.left + 4 &&
        point.x <= Math.min(bounds.left + 170, bounds.right - 6) &&
        point.y >= bounds.top + 2 &&
        point.y <= bounds.top + 24;
      if (!inLabelArea) return;
      setInlineTextEdit({ id: hit.id, value: hit.text ?? "Frame" });
      return;
    }
    if (hit.type !== "sticky" && hit.type !== "text") return;
    setInlineTextEdit({ id: hit.id, value: hit.text ?? "" });
  };

  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || (target as HTMLElement).isContentEditable);
      if (editable) return;
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      if (cmdOrCtrl && event.key.toLowerCase() === "c") {
        event.preventDefault();
        handleCopy();
        return;
      }

      if (cmdOrCtrl && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const allIds = [...boardStateRef.current.order];
        // Keep ref and state in sync immediately for follow-up Delete press.
        selectedIdsRef.current = allIds;
        setSelectedObjectIds(allIds);
        return;
      }

      if (cmdOrCtrl && event.key.toLowerCase() === "x") {
        event.preventDefault();
        handleCut();
        return;
      }

      if (cmdOrCtrl && event.key.toLowerCase() === "v") {
        event.preventDefault();
        handlePaste();
        return;
      }

      if (cmdOrCtrl && event.key.toLowerCase() === "d") {
        event.preventDefault();
        handleDuplicate();
        return;
      }

      const key = event.key;
      if (cmdOrCtrl && (key === "+" || key === "=" || key === "Add")) {
        event.preventDefault();
        zoomFromButtons("in");
        return;
      }

      if (cmdOrCtrl && (key === "-" || key === "_" || key === "Subtract")) {
        event.preventDefault();
        zoomFromButtons("out");
        return;
      }

      if (cmdOrCtrl && key === "0") {
        event.preventDefault();
        resetZoomToDefault();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        handleDelete();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setInlineTextEdit(null);
        setMarqueeSelection(null);
        setShowLineTypeModal(false);
        setShowLineInfo(false);
        setConnectionPointModal(null);
        setLineToolActive(false);
        setLineType(null);
        setLineStartPoint(null);
        setConnectDraft(null);
        stopDragging();
        setActiveTool("cursor");
      }
    };
    // Capture phase prevents browser "select all page" from winning first.
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [canvasMousePos, clipboard]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
      return target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.code !== "Space" || event.repeat || isSpacePressedRef.current) return;
      event.preventDefault();
      isSpacePressedRef.current = true;
      previousToolBeforeSpaceRef.current = activeToolRef.current;
      setActiveTool("hand");
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !isSpacePressedRef.current) return;
      event.preventDefault();
      isSpacePressedRef.current = false;
      const restoreTool = previousToolBeforeSpaceRef.current;
      setActiveTool(restoreTool);
      if (restoreTool !== "hand") {
        setIsPanning(false);
        isPanningRef.current = false;
      }
    };

    const onWindowBlur = () => {
      if (!isSpacePressedRef.current) return;
      isSpacePressedRef.current = false;
      const restoreTool = previousToolBeforeSpaceRef.current;
      setActiveTool(restoreTool);
      if (restoreTool !== "hand") {
        setIsPanning(false);
        isPanningRef.current = false;
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    window.__collabboardPerf = {
      seedObjects: (count: number) => {
        const origin = {
          x: -viewportRef.current.x / viewportRef.current.zoom + 50,
          y: -viewportRef.current.y / viewportRef.current.zoom + 50,
        };
        let next = boardStateRef.current;
        for (let i = 0; i < count; i += 1) {
          const types: BoardObjectType[] = ["sticky", "rectangle", "circle", "line", "text"];
          const created = createBoardObject(
            types[i % types.length],
            {
              x: origin.x + (i % 25) * 24,
              y: origin.y + Math.floor(i / 25) * 20,
            },
            userId,
          );
          next = upsertBoardObject(next, created);
        }
        setBoardState(next);
        schedulePersistence(next);
        return next.order.length;
      },
      clearObjects: () => {
        setBoardState(INITIAL_BOARD_STATE);
        setSelectedObjectIds([]);
        schedulePersistence(INITIAL_BOARD_STATE);
      },
      setMockCollaborators: (count: number) => {
        const next: Record<string, RemoteCollaborator> = {};
        for (let i = 0; i < count; i += 1) {
          const fakeUserId = `mock-user-${i + 1}`;
          const key = `mock-session-${i + 1}`;
          next[key] = {
            key,
            userId: fakeUserId,
            label: `Mock ${i + 1}`,
            color: colorFromUserId(fakeUserId),
            boardName: boardNameRef.current,
            lastActiveAt: Date.now() - i,
          };
        }
        setMockCollaborators(next);
        return Object.keys(next).length;
      },
      clearMockCollaborators: () => {
        setMockCollaborators({});
      },
      getMetrics: () => ({
        objectCount: boardStateRef.current.order.length,
        selectedCount: selectedIdsRef.current.length,
      }),
    };
    return () => {
      if (window.__collabboardPerf) delete window.__collabboardPerf;
    };
  }, [userId]);

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
        onDoubleClick={handleCanvasDoubleClick}
        onContextMenu={handleCanvasContextMenu}
      />

      <div className="absolute left-5 top-4 rounded-xl border border-slate-400 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">CollabBoard</span>
          <span className="text-slate-400">|</span>
          <span>{boardName || "Untitled Board"}</span>
          <button type="button" className="rounded-md border border-slate-400 px-3 py-1 text-xs hover:bg-slate-50">
            Options
          </button>
        </div>
      </div>

      <div className="absolute right-5 top-4 rounded-xl border border-slate-400 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-3 text-sm">
          <span className="h-10 w-10 rounded-full border border-slate-400" style={{ backgroundColor: userColor }} />
          <span>{userLabel}</span>
          <button type="button" className="rounded-md border border-slate-400 px-3 py-1 text-xs hover:bg-slate-50">
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
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true">
              <path
                d="M9 15L6.5 17.5C4.6 19.4 4.6 22.4 6.5 24.3C8.4 26.2 11.4 26.2 13.3 24.3L17 20.6C18.9 18.7 18.9 15.7 17 13.8C16.5 13.3 15.9 13 15.3 12.8"
                transform="translate(0 -3) scale(0.9)"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M15 9L17.5 6.5C19.4 4.6 22.4 4.6 24.3 6.5C26.2 8.4 26.2 11.4 24.3 13.3L20.6 17C18.7 18.9 15.7 18.9 13.8 17C13.3 16.5 13 15.9 12.8 15.3"
                transform="translate(-3 0) scale(0.9)"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="truncate text-xs text-slate-500">{boardId}</p>
          </div>
          <button
            type="button"
            onClick={copyBoardId}
            className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
          >
            Copy
          </button>
        </div>
        <p className="mt-3 text-sm">Zoom:</p>
        <p className="mt-1 text-xs text-slate-500">{Math.round(viewport.zoom * 100)}%</p>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <p className="text-sm">Collaborators:</p>
            <p className="text-xs text-slate-500" data-testid="collaborator-online-count">
              {totalOnlineCount} online
            </p>
          </div>
          <div className="flex -space-x-2" data-testid="collaborator-avatars">
            {displayedCollaborators.map((collaborator) => (
              <span
                key={collaborator.userId}
                data-testid={`collaborator-avatar-${collaborator.userId}`}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md"
                style={{ backgroundColor: collaborator.color }}
                title={collaborator.label}
              >
                {(collaborator.label || "?").trim().charAt(0).toUpperCase() || "?"}
              </span>
            ))}
            {overflowCollaboratorCount > 0 ? (
              <span
                data-testid="collaborator-overflow"
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-400 text-[10px] font-bold text-white shadow-md"
                title={`${overflowCollaboratorCount} more collaborator(s)`}
              >
                +{overflowCollaboratorCount}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mt-4 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to Dashboard
        </button>
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
                  if (item.id === "line") {
                    setShowLineTypeModal(true);
                    return;
                  }
                  if (lineToolActive || lineType || lineStartPoint) {
                    resetLineCreationMode();
                  }
                  setActiveTool(item.id);
                  if (item.id !== "hand") stopDragging();
                }}
                className={
                  item.id === "cursor"
                    ? `group relative flex h-12 w-12 items-center justify-center rounded-xl border text-xl transition ${
                        isActive
                          ? "border-slate-900 bg-white text-slate-900"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`
                    : `group relative flex h-12 w-12 items-center justify-center rounded-xl border text-xl transition ${
                        isActive
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`
                }
              >
                {item.id === "cursor" ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-slate-100">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                      <path
                        d="M4 2.8L19.2 13.6L12.5 14.2L8.7 21L8.4 9.8L4 2.8Z"
                        fill="#f8fafc"
                        stroke="#111827"
                        strokeWidth="2.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : item.id === "frame" ? (
                  <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
                    <rect
                      x="4"
                      y="5"
                      width="16"
                      height="13"
                      rx="2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeDasharray="3 2"
                    />
                  </svg>
                ) : item.id === "line" ? (
                  <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
                    <path d="M4 15L20 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    <path
                      d="M16.5 8.5L20.5 9L18 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
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

      {showLineTypeModal ? (
        <div className="absolute bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-slate-300 bg-white/95 p-3 shadow-xl transition-opacity duration-150 hover:opacity-45">
          <p className="mb-2 text-xs font-medium text-slate-700">Choose line type</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLineType("arrow");
                setShowLineTypeModal(false);
                setShowLineInfo(true);
              }}
              className="flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
            >
              <span>→</span>
              <span>Arrow</span>
            </button>
            <span className="text-xs text-slate-400">or</span>
            <button
              type="button"
              onClick={() => {
                setLineType("simple");
                setShowLineTypeModal(false);
                setShowLineInfo(true);
              }}
              className="flex items-center gap-1.5 rounded-md bg-gray-500 px-3 py-2 text-sm text-white hover:bg-gray-600"
            >
              <span>—</span>
              <span>Simple</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowLineTypeModal(false);
                setLineType(null);
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {showLineInfo ? (
        <div className="absolute bottom-24 left-1/2 z-50 w-[28rem] -translate-x-1/2 rounded-xl border border-slate-300 bg-white/95 p-4 shadow-xl transition-opacity duration-150 hover:opacity-45">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">How to create connectors</h2>
          <p className="mb-2 text-xs text-gray-700">
            Click a shape (rectangle, circle, sticky note, text, frame, or existing line) to set a start point, then
            click another shape or canvas point to create connector.
          </p>
          <p className="mb-3 text-[11px] text-gray-600">Tip: use connection dots for precise anchors.</p>
          <button
            type="button"
            onClick={() => {
              if (!lineType) {
                setShowLineInfo(false);
                return;
              }
              setShowLineInfo(false);
              setLineToolActive(true);
              setLineStartPoint(null);
              setActiveTool("line");
            }}
            className="w-full rounded bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
          >
            Got it
          </button>
        </div>
      ) : null}

      {connectionPointModal ? (
        <ConnectionPointModal
          x={connectionPointModal.x}
          y={connectionPointModal.y}
          onSelectArrow={() => {
            setConnectionPointModal(null);
            beginLineFromStart(connectionPointModal.start, "arrow");
          }}
          onSelectLine={() => {
            setConnectionPointModal(null);
            beginLineFromStart(connectionPointModal.start, "simple");
          }}
          onCancel={() => setConnectionPointModal(null)}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDuplicate={() => {
            handleDuplicate();
            setContextMenu(null);
          }}
          onCopy={() => {
            handleCopy();
            setContextMenu(null);
          }}
          onPaste={() => {
            handlePaste();
            setContextMenu(null);
          }}
          onDelete={() => {
            handleDelete();
            setContextMenu(null);
          }}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {frameDraft ? (
        <div
          className="pointer-events-none absolute z-20 border-2 border-dashed border-slate-500 bg-slate-200/20"
          style={{
            left: Math.min(screenFromWorld(frameDraft.start).x, screenFromWorld(frameDraft.end).x),
            top: Math.min(screenFromWorld(frameDraft.start).y, screenFromWorld(frameDraft.end).y),
            width: Math.abs(screenFromWorld(frameDraft.end).x - screenFromWorld(frameDraft.start).x),
            height: Math.abs(screenFromWorld(frameDraft.end).y - screenFromWorld(frameDraft.start).y),
          }}
        />
      ) : null}

      {frameChildHighlightItems.map((item) => (
        <div
          key={`frame-child-${item.id}`}
          className="pointer-events-none absolute z-10 border border-blue-400/70"
          style={{ left: item.left - 1, top: item.top - 1, width: item.width + 2, height: item.height + 2 }}
        />
      ))}

      {remoteSelectionOverlayItems.map((item) => (
        <div
          key={item.key}
          className="pointer-events-none absolute z-15 border-2"
          style={{
            left: item.left - 2,
            top: item.top - 2,
            width: item.width + 4,
            height: item.height + 4,
            borderColor: item.color,
          }}
          title={`${item.label} selecting`}
        />
      ))}

      {contextMenuPosition && hasSelectedColorTarget ? (
        <div
          className="absolute z-30 rounded-2xl border border-slate-400 bg-white/95 p-2 shadow-sm transition-opacity duration-150 hover:opacity-45"
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
        >
          <div className="mb-2 flex items-center gap-2">
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Set color ${color}`}
                data-testid={`color-swatch-${color.replace("#", "")}`}
                className="h-6 w-6 rounded-full border border-slate-300"
                style={{ backgroundColor: color }}
                onClick={() => applyColorToSelected(color)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={handleDuplicate}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Duplicate
          </button>
        </div>
      ) : null}

      {selectedOverlayItems.map((item) => {
        return (
          <div
            key={item.id}
            data-testid="selection-outline"
            className="pointer-events-none absolute border-2 border-blue-500"
            style={{ left: item.left - 2, top: item.top - 2, width: item.width + 4, height: item.height + 4 }}
          >
            {primarySelectedObject?.id === item.id ? (
              <>
                <button
                  type="button"
                  data-testid="rotate-handle-tl"
                  onPointerDown={startRotate}
                  className="pointer-events-auto absolute rounded-full border-2 border-white bg-violet-500"
                  style={{ left: -9, top: -24, width: 12, height: 12 }}
                />
                <button
                  type="button"
                  data-testid="resize-handle-nw"
                  onPointerDown={(event) => startResize(event, "nw")}
                  className="pointer-events-auto absolute rounded-full border-2 border-white bg-blue-500"
                  style={{ left: -7, top: -7, width: RESIZE_HANDLE_SIZE_PX + 2, height: RESIZE_HANDLE_SIZE_PX + 2 }}
                />
                <button
                  type="button"
                  data-testid="resize-handle-ne"
                  onPointerDown={(event) => startResize(event, "ne")}
                  className="pointer-events-auto absolute rounded-full border-2 border-white bg-blue-500"
                  style={{ right: -7, top: -7, width: RESIZE_HANDLE_SIZE_PX + 2, height: RESIZE_HANDLE_SIZE_PX + 2 }}
                />
                <button
                  type="button"
                  data-testid="resize-handle-sw"
                  onPointerDown={(event) => startResize(event, "sw")}
                  className="pointer-events-auto absolute rounded-full border-2 border-white bg-blue-500"
                  style={{ left: -7, bottom: -7, width: RESIZE_HANDLE_SIZE_PX + 2, height: RESIZE_HANDLE_SIZE_PX + 2 }}
                />
                <button
                  type="button"
                  data-testid="resize-handle-se"
                  onPointerDown={(event) => startResize(event, "se")}
                  className="pointer-events-auto absolute rounded-full border-2 border-white bg-blue-500"
                  style={{ right: -7, bottom: -7, width: RESIZE_HANDLE_SIZE_PX + 2, height: RESIZE_HANDLE_SIZE_PX + 2 }}
                />
              </>
            ) : null}
          </div>
        );
      })}

      {primarySelectedObject
        ? selectedConnectionPoints.map((connectionPoint) => {
            const isActiveStart =
              lineToolActive &&
              lineStartPoint?.objectId === primarySelectedObject.id &&
              lineStartPoint.anchor === connectionPoint.anchor;
            const fillColor = isActiveStart
              ? "#16a34a"
              : hoveredConnectionAnchor === connectionPoint.anchor
                ? "#2563eb"
                : "#9ca3af";
            return (
              <button
                key={`connection-point-${primarySelectedObject.id}-${connectionPoint.anchor}`}
                type="button"
                data-testid={`connection-point-${connectionPoint.anchor}`}
                className="absolute z-30 rounded-full border-2 border-white shadow-sm"
                style={{
                  left: connectionPoint.left - CONNECTION_POINT_RADIUS_PX,
                  top: connectionPoint.top - CONNECTION_POINT_RADIUS_PX,
                  width: CONNECTION_POINT_RADIUS_PX * 2,
                  height: CONNECTION_POINT_RADIUS_PX * 2,
                  backgroundColor: fillColor,
                  boxShadow: hoveredConnectionAnchor === connectionPoint.anchor ? "0 0 0 4px rgba(37,99,235,0.18)" : undefined,
                }}
                onPointerEnter={() => setHoveredConnectionAnchor(connectionPoint.anchor)}
                onPointerLeave={() => setHoveredConnectionAnchor(null)}
                onPointerDown={(event) =>
                  handleConnectionPointClick(event, connectionPoint.anchor, connectionPoint.point)
                }
              />
            );
          })
        : null}

      {frameDeletePrompt ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-300 bg-white p-4 shadow-xl">
            <p className="text-sm font-semibold text-slate-900">Delete Frame</p>
            <p className="mt-1 text-sm text-slate-600">
              This frame contains {frameDeletePrompt.childIds.length} object(s). Choose how to delete.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleDeleteFrameOnly}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Delete frame only
              </button>
              <button
                type="button"
                onClick={handleDeleteFrameAndContents}
                className="w-full rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                Delete frame and contents
              </button>
              <button
                type="button"
                onClick={() => setFrameDeletePrompt(null)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {connectDraft ? (
        <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full">
          <line
            x1={screenFromWorld(connectDraft.fromPoint).x}
            y1={screenFromWorld(connectDraft.fromPoint).y}
            x2={screenFromWorld(connectDraft.toPoint).x}
            y2={screenFromWorld(connectDraft.toPoint).y}
            stroke="#2563eb"
            strokeWidth="2"
            strokeDasharray="6 4"
          />
        </svg>
      ) : null}

      {dragConstraintGuide ? (
        <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full">
          <line
            x1={screenFromWorld(dragConstraintGuide.from).x}
            y1={screenFromWorld(dragConstraintGuide.from).y}
            x2={screenFromWorld(dragConstraintGuide.to).x}
            y2={screenFromWorld(dragConstraintGuide.to).y}
            stroke="#2563eb"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        </svg>
      ) : null}

      {rotationTooltip ? (
        <div
          className="pointer-events-none absolute z-40 rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white shadow"
          style={{ left: rotationTooltip.left, top: rotationTooltip.top }}
        >
          {Math.round(rotationTooltip.degrees)}°
        </div>
      ) : null}

      {inlineTextEdit && (() => {
        const object = boardState.objects[inlineTextEdit.id];
        if (!object) return null;
        const isSticky = object.type === "sticky";
        const editorFontSize = object.type === "text" ? clampTextFontSize((object.fontSize ?? 16) * viewport.zoom) : undefined;
        const isFrameLabel = object.type === "frame";
        const screen = isFrameLabel
          ? {
              left: viewport.x + object.x * viewport.zoom + 6,
              top: viewport.y + object.y * viewport.zoom + 4,
              width: Math.max(120, Math.min(220, object.width * viewport.zoom - 12)),
              height: 24,
            }
          : {
              left: viewport.x + object.x * viewport.zoom,
              top: viewport.y + object.y * viewport.zoom,
              width: Math.max(120, object.width * viewport.zoom),
              height: Math.max(48, object.height * viewport.zoom),
            };
        return (
          <textarea
            data-testid="inline-text-editor"
            autoFocus
            value={inlineTextEdit.value}
            onFocus={(event) => {
              if (object.type === "text" && inlineTextEdit.value === "Text") {
                event.currentTarget.select();
              }
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              setInlineTextEdit((current) => {
                if (!current) return current;
                if (object.type !== "text") {
                  return { ...current, value: nextValue };
                }
                if (current.value === "Text" && nextValue.startsWith("Text")) {
                  return { ...current, value: nextValue.slice("Text".length) };
                }
                return { ...current, value: nextValue };
              });
            }}
            onBlur={commitInlineTextEdit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setInlineTextEdit(null);
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                commitInlineTextEdit();
              }
            }}
            className="absolute z-40 resize-none rounded-md border-2 border-blue-500 bg-white p-2 text-sm text-slate-900 shadow-md outline-none"
            style={{
              ...screen,
              backgroundColor: isSticky ? object.color : isFrameLabel ? "rgba(255,255,255,0.95)" : "#ffffff",
              color: isFrameLabel ? "#334155" : isSticky ? "#0f172a" : object.color,
              fontFamily: object.type === "text" || isFrameLabel ? "Arial, sans-serif" : undefined,
              fontSize: isFrameLabel ? "12px" : editorFontSize ? `${editorFontSize}px` : undefined,
              fontWeight: isFrameLabel ? 700 : undefined,
              lineHeight: isFrameLabel ? "1.2" : undefined,
              padding: isFrameLabel ? "4px 6px" : undefined,
            }}
          />
        );
      })()}

      {marqueeSelection ? (
        <div
          className="pointer-events-none absolute z-20 border border-blue-500 bg-blue-100/20"
          style={{
            left: Math.min(screenFromWorld(marqueeSelection.start).x, screenFromWorld(marqueeSelection.end).x),
            top: Math.min(screenFromWorld(marqueeSelection.start).y, screenFromWorld(marqueeSelection.end).y),
            width: Math.abs(screenFromWorld(marqueeSelection.end).x - screenFromWorld(marqueeSelection.start).x),
            height: Math.abs(screenFromWorld(marqueeSelection.end).y - screenFromWorld(marqueeSelection.start).y),
          }}
        />
      ) : null}

      {dedupedRemoteCursors.map((cursor) => {
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
            <svg viewBox="0 0 24 24" className="h-5 w-5 drop-shadow-sm" aria-hidden="true">
              <path
                d="M4 2.8L19.2 13.6L12.5 14.2L8.7 21L8.4 9.8L4 2.8Z"
                fill="transparent"
                stroke="#111827"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div
              className="mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium text-white shadow-sm"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.label}
            </div>
          </div>
        );
      })}

      <div
        data-testid="board-metrics"
        data-object-count={String(boardState.order.length)}
        data-selected-count={String(selectedObjectIds.length)}
        data-last-remote-cursor-latency={String(lastRemoteCursorLatencyMs ?? -1)}
        data-last-remote-object-latency={String(lastRemoteObjectLatencyMs ?? -1)}
        data-collaborator-count={String(totalOnlineCount)}
        data-board-loaded={String(isLoadedFromStoreRef.current)}
        data-selected-x={String(primarySelectedObject?.x ?? -1)}
        data-selected-y={String(primarySelectedObject?.y ?? -1)}
        data-selected-width={String(primarySelectedObject?.width ?? -1)}
        data-selected-height={String(primarySelectedObject?.height ?? -1)}
        data-selected-rotation={String(primarySelectedObject?.rotation ?? 0)}
        data-selected-text={primarySelectedObject?.text ?? ""}
        className="sr-only"
      >
        board metrics
      </div>
    </div>
  );
}
