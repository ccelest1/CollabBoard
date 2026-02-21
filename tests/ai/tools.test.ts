import { describe, expect, it, vi } from "vitest";
import type { BoardObject } from "@/lib/boards/model";
import { createBoardTools, type BoardMutationHandlers } from "@/lib/ai/tools";

function makeObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: "obj-1",
    type: "sticky",
    x: 0,
    y: 0,
    width: 150,
    height: 150,
    color: "#fde68a",
    text: "hello",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: "tester",
    ...overrides,
  };
}

describe("AI tools", () => {
  it("invokes all 9 tools and returns serializable payloads", async () => {
    const sticky = makeObject({ id: "sticky-1", type: "sticky" });
    const rectangle = makeObject({ id: "shape-1", type: "rectangle" });
    const frame = makeObject({ id: "frame-1", type: "frame", text: "Frame" });
    const line = makeObject({ id: "line-1", type: "line" });
    const moved = makeObject({ id: "move-1", x: 50, y: 80 });
    const resized = makeObject({ id: "resize-1", width: 300, height: 120 });
    const updated = makeObject({ id: "text-1", text: "updated" });
    const recolored = makeObject({ id: "color-1", color: "#22c55e" });
    const board = [sticky, rectangle];

    const handlers: BoardMutationHandlers = {
      createStickyNote: vi.fn().mockResolvedValue(sticky),
      createShape: vi.fn().mockResolvedValue(rectangle),
      createFrame: vi.fn().mockResolvedValue(frame),
      createConnector: vi.fn().mockResolvedValue(line),
      moveObject: vi.fn().mockResolvedValue(moved),
      resizeObject: vi.fn().mockResolvedValue(resized),
      updateText: vi.fn().mockResolvedValue(updated),
      changeColor: vi.fn().mockResolvedValue(recolored),
      getBoardObjects: vi.fn().mockResolvedValue(board),
    };

    const tools = createBoardTools(handlers);

    await expect(
      tools.createStickyNote.invoke({ text: "A", x: 1, y: 2, color: "#fde68a" }),
    ).resolves.toMatchObject({ id: "sticky-1", type: "sticky" });
    await expect(
      tools.createShape.invoke({ type: "rectangle", x: 0, y: 0, width: 100, height: 80, color: "#93c5fd" }),
    ).resolves.toMatchObject({ id: "shape-1", type: "rectangle" });
    await expect(
      tools.createFrame.invoke({ title: "F", x: 0, y: 0, width: 200, height: 200 }),
    ).resolves.toMatchObject({ id: "frame-1", type: "frame" });
    await expect(
      tools.createConnector.invoke({ fromId: "a", toId: "b", style: "arrow" }),
    ).resolves.toMatchObject({ id: "line-1", type: "line" });
    await expect(tools.moveObject.invoke({ objectId: "move-1", x: 50, y: 80 })).resolves.toMatchObject({ x: 50, y: 80 });
    await expect(
      tools.resizeObject.invoke({ objectId: "resize-1", width: 300, height: 120 }),
    ).resolves.toMatchObject({ width: 300, height: 120 });
    await expect(
      tools.updateText.invoke({ objectId: "text-1", newText: "updated" }),
    ).resolves.toMatchObject({ text: "updated" });
    await expect(
      tools.changeColor.invoke({ objectId: "color-1", color: "#22c55e" }),
    ).resolves.toMatchObject({ color: "#22c55e" });
    await expect(tools.getBoardState.invoke({})).resolves.toMatchObject({
      objects: [
        expect.objectContaining({ id: "sticky-1" }),
        expect.objectContaining({ id: "shape-1" }),
      ],
    });

    expect(handlers.createStickyNote).toHaveBeenCalledTimes(1);
    expect(handlers.createShape).toHaveBeenCalledTimes(1);
    expect(handlers.createFrame).toHaveBeenCalledTimes(1);
    expect(handlers.createConnector).toHaveBeenCalledTimes(1);
    expect(handlers.moveObject).toHaveBeenCalledTimes(1);
    expect(handlers.resizeObject).toHaveBeenCalledTimes(1);
    expect(handlers.updateText).toHaveBeenCalledTimes(1);
    expect(handlers.changeColor).toHaveBeenCalledTimes(1);
    expect(handlers.getBoardObjects).toHaveBeenCalledTimes(1);
  });
});
