"use client";

interface ConnectionPointModalProps {
  x: number;
  y: number;
  onSelectArrow: () => void;
  onSelectLine: () => void;
  onCancel: () => void;
}

export default function ConnectionPointModal({
  x,
  y,
  onSelectArrow,
  onSelectLine,
  onCancel,
}: ConnectionPointModalProps) {
  return (
    <div className="fixed inset-0 z-50" onClick={onCancel}>
      <div
        className="fixed rounded-lg border border-gray-200 bg-white/95 p-3 shadow-xl transition-opacity duration-150 hover:opacity-45"
        style={{ left: x, top: y, transform: "translate(-50%, -100%) translateY(-10px)" }}
        onWheel={() => {
          // Intentionally empty: allows scroll-over transparency behavior via hover state.
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-2 text-xs text-gray-600">Create connector from this point:</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectArrow}
            className="flex items-center gap-1.5 rounded bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
          >
            <span>→</span>
            <span>Arrow</span>
          </button>
          <span className="text-xs text-gray-400">or</span>
          <button
            type="button"
            onClick={onSelectLine}
            className="flex items-center gap-1.5 rounded bg-gray-500 px-3 py-2 text-sm text-white hover:bg-gray-600"
          >
            <span>—</span>
            <span>Simple</span>
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-300"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

