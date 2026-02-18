export type BoardObjectType = "sticky" | "rectangle" | "circle" | "line" | "text" | "frame";
export type ToolId = "hand" | "cursor" | BoardObjectType;

export type WorldPoint = {
  x: number;
  y: number;
};

export type BoardObject = {
  id: string;
  type: BoardObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  parentFrameId?: string;
  lineStyle?: "simple" | "arrow";
  startObjectId?: string;
  endObjectId?: string;
  startAnchor?: "top" | "right" | "bottom" | "left";
  endAnchor?: "top" | "right" | "bottom" | "left";
  rotation?: number;
  x2?: number;
  y2?: number;
  text?: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export type BoardStateNormalized = {
  order: string[];
  objects: Record<string, BoardObject>;
};

const DEFAULT_WIDTH_BY_TYPE: Record<BoardObjectType, number> = {
  sticky: 180,
  rectangle: 190,
  circle: 150,
  line: 140,
  text: 200,
  frame: 320,
};

const DEFAULT_HEIGHT_BY_TYPE: Record<BoardObjectType, number> = {
  sticky: 140,
  rectangle: 120,
  circle: 150,
  line: 0,
  text: 46,
  frame: 220,
};

const DEFAULT_COLOR_BY_TYPE: Record<BoardObjectType, string> = {
  sticky: "#fde68a",
  rectangle: "#93c5fd",
  circle: "#86efac",
  line: "#334155",
  text: "#0f172a",
  frame: "rgba(200, 200, 200, 0.1)",
};

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createBoardObjectId() {
  return randomId();
}

export function isDrawableTool(tool: ToolId): tool is BoardObjectType {
  return tool !== "hand" && tool !== "cursor";
}

export function normalizeBoardObjects(objects: BoardObject[]): BoardStateNormalized {
  const order: string[] = [];
  const byId: Record<string, BoardObject> = {};
  for (const item of objects) {
    if (!item?.id) continue;
    order.push(item.id);
    byId[item.id] = item;
  }
  return { order, objects: byId };
}

export function denormalizeBoardObjects(state: BoardStateNormalized) {
  return state.order.map((id) => state.objects[id]).filter(Boolean);
}

export function upsertBoardObject(state: BoardStateNormalized, object: BoardObject): BoardStateNormalized {
  const exists = Boolean(state.objects[object.id]);
  const nextOrder = exists ? state.order : [...state.order, object.id];
  return {
    order: nextOrder,
    objects: {
      ...state.objects,
      [object.id]: object,
    },
  };
}

export function removeBoardObjects(state: BoardStateNormalized, ids: string[]): BoardStateNormalized {
  if (ids.length === 0) return state;
  const skip = new Set(ids);
  const nextObjects = { ...state.objects };
  for (const id of ids) {
    delete nextObjects[id];
  }
  return {
    order: state.order.filter((id) => !skip.has(id)),
    objects: nextObjects,
  };
}

export function createBoardObject(tool: BoardObjectType, point: WorldPoint, updatedBy: string): BoardObject {
  const now = Date.now();
  const width = DEFAULT_WIDTH_BY_TYPE[tool];
  const height = DEFAULT_HEIGHT_BY_TYPE[tool];
  const base: BoardObject = {
    id: randomId(),
    type: tool,
    x: point.x,
    y: point.y,
    width,
    height,
    rotation: 0,
    color: DEFAULT_COLOR_BY_TYPE[tool],
    createdAt: now,
    updatedAt: now,
    updatedBy,
  };

  if (tool === "line") {
    base.x2 = point.x + width;
    base.y2 = point.y;
  }
  if (tool === "text") {
    base.text = "Text";
    base.fontSize = 16;
  }
  if (tool === "sticky") {
    base.text = "Sticky note";
  }
  if (tool === "frame") {
    base.text = "Frame";
  }

  return base;
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  const projX = x1 + clamped * dx;
  const projY = y1 + clamped * dy;
  return Math.hypot(px - projX, py - projY);
}

export function hitTestBoardObject(object: BoardObject, point: WorldPoint) {
  if (object.type === "line") {
    const x2 = object.x2 ?? object.x + object.width;
    const y2 = object.y2 ?? object.y;
    return pointToSegmentDistance(point.x, point.y, object.x, object.y, x2, y2) <= 10;
  }

  const centerX = object.x + object.width / 2;
  const centerY = object.y + object.height / 2;
  const rotation = object.rotation ?? 0;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localX = centerX + (point.x - centerX) * cos - (point.y - centerY) * sin;
  const localY = centerY + (point.x - centerX) * sin + (point.y - centerY) * cos;

  if (object.type === "circle") {
    const cx = centerX;
    const cy = centerY;
    const rx = object.width / 2;
    const ry = object.height / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (localX - cx) / rx;
    const dy = (localY - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }

  return (
    localX >= object.x &&
    localX <= object.x + object.width &&
    localY >= object.y &&
    localY <= object.y + object.height
  );
}
