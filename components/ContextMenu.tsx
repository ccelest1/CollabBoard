"use client";

type ContextMenuProps = {
  x: number;
  y: number;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export default function ContextMenu({ x, y, onDuplicate, onCopy, onPaste, onDelete, onClose }: ContextMenuProps) {
  return (
    <div
      className="fixed z-50 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      style={{ left: x, top: y }}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onDuplicate}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-100"
      >
        <span>Duplicate</span>
        <span className="text-sm text-gray-400">⌘D</span>
      </button>
      <button
        type="button"
        onClick={onCopy}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-100"
      >
        <span>Copy</span>
        <span className="text-sm text-gray-400">⌘C</span>
      </button>
      <button
        type="button"
        onClick={onPaste}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-100"
      >
        <span>Paste</span>
        <span className="text-sm text-gray-400">⌘V</span>
      </button>
      <div className="my-1 border-t border-gray-200" />
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-red-600 hover:bg-red-50"
      >
        <span>Delete</span>
        <span className="text-sm text-gray-400">Del</span>
      </button>
    </div>
  );
}

