"use client";

import { useEffect, useRef } from "react";
import { Canvas, Point } from "fabric";

export function BoardWorkspace() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
      fabricCanvas.setDimensions({
        width: rect.width,
        height: rect.height,
      });
      fabricCanvas.requestRenderAll();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);

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

    fabricCanvas.requestRenderAll();

    return () => {
      observer.disconnect();
      fabricCanvas.off("after:render", renderGrid);
      fabricCanvas.off("mouse:down", onMouseDown);
      fabricCanvas.off("mouse:move", onMouseMove);
      fabricCanvas.off("mouse:up", onMouseUp);
      fabricCanvas.off("mouse:wheel", onWheel);
      fabricCanvas.dispose();
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-white">
      {/* top tool bar placeholder */}
      <div className="absolute left-0 right-0 top-0 z-10 h-12 border-b border-slate-200 bg-white/95 px-3">
        <div className="flex h-full items-center gap-2 text-sm text-slate-700">
          <span className="rounded border border-slate-300 px-2 py-1">Select</span>
          <span className="rounded border border-slate-300 px-2 py-1">Pen</span>
          <span className="rounded border border-slate-300 px-2 py-1">Text</span>
          <span className="rounded border border-slate-300 px-2 py-1">Shape</span>
        </div>
      </div>

      {/* side tool bar placeholder */}
      <div className="absolute bottom-0 left-0 top-12 z-10 w-14 border-r border-slate-200 bg-white/95">
        <div className="flex h-full flex-col items-center gap-2 p-2 text-xs text-slate-700">
          <div className="h-8 w-8 rounded border border-slate-300" />
          <div className="h-8 w-8 rounded border border-slate-300" />
          <div className="h-8 w-8 rounded border border-slate-300" />
        </div>
      </div>

      <div ref={wrapperRef} className="absolute bottom-0 left-14 right-0 top-12">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </div>
  );
}
