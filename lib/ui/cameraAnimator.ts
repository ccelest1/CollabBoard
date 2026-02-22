import type * as fabric from "fabric";

type CameraBox = { x: number; y: number; width: number; height: number };

export let cancelCurrentAnimation: () => void = () => {};

export function animateCameraToBox(params: {
  canvas: fabric.Canvas;
  box: CameraBox;
  padding?: number;
  durationMs?: number;
  onComplete?: () => void;
}): () => void {
  cancelCurrentAnimation();

  const { canvas, box, onComplete } = params;
  const padding = params.padding ?? 80;
  const durationMs = params.durationMs ?? 400;

  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();

  const safeWidth = Math.max(1, box.width);
  const safeHeight = Math.max(1, box.height);
  const targetZoom = Math.min(
    (canvasWidth - padding * 2) / safeWidth,
    (canvasHeight - padding * 2) / safeHeight,
    2.0,
  );
  const finalZoom = Math.max(0.1, targetZoom);

  const startTransform = (canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0]) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const startZoom = startTransform[0] ?? 1;
  const startPanX = startTransform[4] ?? 0;
  const startPanY = startTransform[5] ?? 0;

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const targetPanX = canvasWidth / 2 - centerX * finalZoom;
  const targetPanY = canvasHeight / 2 - centerY * finalZoom;

  let rafId = 0;
  let stopped = false;
  const startedAt = performance.now();

  const cancel = () => {
    if (stopped) return;
    stopped = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  };

  cancelCurrentAnimation = cancel;

  const frame = (now: number) => {
    if (stopped) return;

    const elapsed = now - startedAt;
    const normalized = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - normalized, 3);

    const zoom = startZoom + (finalZoom - startZoom) * eased;
    const panX = startPanX + (targetPanX - startPanX) * eased;
    const panY = startPanY + (targetPanY - startPanY) * eased;

    canvas.setViewportTransform([zoom, 0, 0, zoom, panX, panY]);
    canvas.requestRenderAll();

    if (normalized < 1) {
      rafId = requestAnimationFrame(frame);
      return;
    }

    stopped = true;
    onComplete?.();
  };

  rafId = requestAnimationFrame(frame);
  return cancel;
}

export function fitAllToScreen(params: {
  canvas: fabric.Canvas;
  padding?: number;
  durationMs?: number;
  onComplete?: () => void;
}): void {
  const objects = params.canvas.getObjects();
  if (objects.length === 0) return;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const object of objects) {
    const left = Number(object.left ?? 0);
    const top = Number(object.top ?? 0);
    const width = Number(object.width ?? 0) * Number(object.scaleX ?? 1);
    const height = Number(object.height ?? 0) * Number(object.scaleY ?? 1);

    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + width);
    maxY = Math.max(maxY, top + height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return;
  }

  void animateCameraToBox({
    canvas: params.canvas,
    box: { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
    padding: params.padding ?? 120,
    durationMs: params.durationMs,
    onComplete: params.onComplete,
  });
}
