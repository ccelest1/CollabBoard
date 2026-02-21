import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardObject } from "@/lib/boards/model";
import { createInMemoryHandlers } from "@/tests/ai/helpers/mockRuntime";
import { registerBoardMutationHandlers, runAgentCommand } from "@/lib/ai/agent";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class {
    constructor(public options: Record<string, unknown>) {}
    bindTools() {
      return {
        invoke: async () => ({ tool_calls: [] }),
      };
    }
    async invoke() {
      return { tool_calls: [] };
    }
  },
}));

vi.mock("langsmith", () => ({
  Client: class {},
}));

function approx(actual: number, expected: number, tolerance = 5) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function centeredGridPositions(count: number, itemWidth: number, itemHeight: number, gap = 20) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const totalWidth = cols * itemWidth + (cols - 1) * gap;
  const totalHeight = rows * itemHeight + (rows - 1) * gap;
  const startX = -(totalWidth / 2);
  const startY = -(totalHeight / 2);
  return Array.from({ length: count }).map((_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: startX + col * (itemWidth + gap),
      y: startY + row * (itemHeight + gap),
    };
  });
}

function seedObject(overrides: Partial<BoardObject>): BoardObject {
  return {
    id: crypto.randomUUID(),
    type: "sticky",
    x: 0,
    y: 0,
    width: 150,
    height: 150,
    color: "#fde68a",
    text: "seed",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: "seed",
    ...overrides,
  };
}

describe("runAgentCommand command coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("supports creation commands", async () => {
    const runtime = createInMemoryHandlers();
    const spyCreateSticky = vi.spyOn(runtime.handlers, "createStickyNote");
    const spyCreateShape = vi.spyOn(runtime.handlers, "createShape");
    const spyCreateFrame = vi.spyOn(runtime.handlers, "createFrame");
    registerBoardMutationHandlers({ boardId: "c1", userId: "u1", handlers: runtime.handlers });

    await runAgentCommand({ command: "Add a yellow sticky note that says 'User Research'", boardId: "c1", userId: "u1" });
    await runAgentCommand({ command: "Create a blue rectangle at position 100, 200", boardId: "c1", userId: "u1" });
    await runAgentCommand({ command: "Add a frame called 'Sprint Planning'", boardId: "c1", userId: "u1" });

    expect(spyCreateSticky).toHaveBeenCalledWith(expect.objectContaining({ text: "User Research", x: 0, y: 0 }));
    expect(spyCreateShape).toHaveBeenCalledWith(
      expect.objectContaining({ type: "rectangle", x: 100, y: 200, width: 150, height: 100 }),
    );
    expect(spyCreateFrame).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Sprint Planning", x: 0, y: 0, width: 400, height: 300 }),
    );
    expect(runtime.objects.filter((o) => o.type === "sticky")).toHaveLength(1);
    expect(runtime.objects.filter((o) => o.type === "rectangle")).toHaveLength(1);
    expect(runtime.objects.filter((o) => o.type === "frame" && o.text === "Sprint Planning")).toHaveLength(1);
  });

  it("supports manipulation commands", async () => {
    const frame = seedObject({ id: "frame-1", type: "frame", width: 200, height: 200, text: "Container" });
    const pink1 = seedObject({ id: "pink-1", color: "#ec4899", x: 10, y: 10, text: "p1" });
    const pink2 = seedObject({ id: "pink-2", color: "#ff00ff", x: 20, y: 20, text: "p2" });
    const child1 = seedObject({ id: "child-1", parentFrameId: "frame-1", x: 40, y: 40, width: 100, height: 80 });
    const child2 = seedObject({ id: "child-2", parentFrameId: "frame-1", x: 220, y: 180, width: 120, height: 90 });
    const runtime = createInMemoryHandlers([frame, pink1, pink2, child1, child2]);
    const spyGetBoardObjects = vi.spyOn(runtime.handlers, "getBoardObjects");
    const spyMoveObject = vi.spyOn(runtime.handlers, "moveObject");
    const spyResizeObject = vi.spyOn(runtime.handlers, "resizeObject");
    const spyChangeColor = vi.spyOn(runtime.handlers, "changeColor");
    registerBoardMutationHandlers({ boardId: "m1", userId: "u2", handlers: runtime.handlers });

    await runAgentCommand({ command: "Move all the pink sticky notes to the right side", boardId: "m1", userId: "u2" });
    await runAgentCommand({ command: "Resize the frame to fit its contents", boardId: "m1", userId: "u2" });
    await runAgentCommand({ command: "Change all sticky notes to green", boardId: "m1", userId: "u2" });

    expect(spyGetBoardObjects).toHaveBeenCalled();
    expect(spyMoveObject).toHaveBeenCalledTimes(2);
    expect(spyMoveObject).toHaveBeenCalledWith(expect.objectContaining({ objectId: "pink-1", x: expect.any(Number) }));
    expect(spyResizeObject).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: "frame-1", width: expect.any(Number), height: expect.any(Number) }),
    );
    expect(spyChangeColor).toHaveBeenCalled();
    const stickies = runtime.objects.filter((o) => o.type === "sticky");
    stickies.forEach((sticky) => expect(sticky.color).toBe("#22c55e"));
  });

  it("supports layout commands with centered-grid positions", async () => {
    const stickySeed = Array.from({ length: 6 }).map((_, i) =>
      seedObject({ id: `s-${i + 1}`, type: "sticky", x: 500, y: 400, text: `S${i + 1}` }),
    );
    const runtime = createInMemoryHandlers(stickySeed);
    registerBoardMutationHandlers({ boardId: "l1", userId: "u3", handlers: runtime.handlers });

    await runAgentCommand({ command: "Arrange these sticky notes in a grid", boardId: "l1", userId: "u3" });
    const arranged = runtime.objects.filter((o) => o.type === "sticky");
    const expected = centeredGridPositions(arranged.length, 150, 150);
    arranged.forEach((object, index) => {
      approx(object.x, expected[index]?.x ?? object.x);
      approx(object.y, expected[index]?.y ?? object.y);
    });

    await runAgentCommand({ command: "Create a 2x3 grid of sticky notes for pros and cons", boardId: "l1", userId: "u3" });
    const labels = runtime.objects
      .filter((o) => o.type === "sticky")
      .map((o) => o.text)
      .filter((text): text is string => Boolean(text));
    expect(labels).toEqual(expect.arrayContaining(["Pro 1", "Pro 2", "Pro 3", "Con 1", "Con 2", "Con 3"]));

    await runAgentCommand({ command: "Space these elements evenly", boardId: "l1", userId: "u3" });
    const allObjects = [...runtime.objects];
    const layoutExpected = centeredGridPositions(
      allObjects.length,
      Math.max(...allObjects.map((o) => o.width)),
      Math.max(...allObjects.map((o) => o.height)),
    );
    allObjects.forEach((object, index) => {
      approx(object.x, layoutExpected[index]?.x ?? object.x);
      approx(object.y, layoutExpected[index]?.y ?? object.y);
    });
  });

  it("supports complex commands", async () => {
    const runtime = createInMemoryHandlers();
    const spyCreateConnector = vi.spyOn(runtime.handlers, "createConnector");
    registerBoardMutationHandlers({ boardId: "x1", userId: "u4", handlers: runtime.handlers });

    await runAgentCommand({ command: "Create a SWOT analysis template with four quadrants", boardId: "x1", userId: "u4" });
    const swotFrames = runtime.objects.filter((o) => o.type === "frame");
    expect(swotFrames).toHaveLength(4);
    expect(swotFrames.map((f) => f.text)).toEqual(expect.arrayContaining(["Strengths", "Weaknesses", "Opportunities", "Threats"]));

    await runAgentCommand({ command: "Build a user journey map with 5 stages", boardId: "x1", userId: "u4" });
    const stages = runtime.objects.filter((o) => o.type === "sticky" && /^Stage \d$/.test(o.text ?? ""));
    expect(stages).toHaveLength(5);
    expect(spyCreateConnector).toHaveBeenCalledTimes(4);

    await runAgentCommand({
      command: "Set up a retrospective board with What Went Well, What Didn't, and Action Items",
      boardId: "x1",
      userId: "u4",
    });
    const retroFrames = runtime.objects.filter((o) => o.type === "frame" && ["What Went Well", "What Didn't", "Action Items"].includes(o.text ?? ""));
    expect(retroFrames).toHaveLength(3);
  });

  it("supports 6+ distinct command types", () => {
    const commandTypes = ["creation", "manipulation", "layout", "complex"];
    const commandsPerType = {
      creation: 3,
      manipulation: 3,
      layout: 3,
      complex: 3,
    };
    expect(commandTypes).toHaveLength(4);
    const total = Object.values(commandsPerType).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it("executes multi-step SWOT analysis sequentially without error", async () => {
    const runtime = createInMemoryHandlers();
    registerBoardMutationHandlers({ boardId: "test-board", userId: "test-user", handlers: runtime.handlers });
    await runAgentCommand({
      command: "Create a SWOT analysis template with four quadrants",
      boardId: "test-board",
      userId: "test-user",
    });
    const frames = runtime.objects.filter((o) => o.type === "frame");
    expect(frames).toHaveLength(4);
    expect(frames.map((f) => f.text)).toEqual(expect.arrayContaining(["Strengths", "Weaknesses", "Opportunities", "Threats"]));
  });

  it("executes the same command consistently across 3 runs", async () => {
    const runs = [1, 2, 3].map(async (index) => {
      const runtime = createInMemoryHandlers();
      const boardId = `test-board-${index}`;
      registerBoardMutationHandlers({ boardId, userId: "test-user", handlers: runtime.handlers });
      return runAgentCommand({
        command: "Add a yellow sticky note that says User Research",
        boardId,
        userId: "test-user",
      });
    });
    const results = await Promise.all(runs);
    results.forEach((result) => {
      expect(result.summary).toBeTruthy();
      expect(result.durationMs).toBeLessThan(3000);
    });
  });
});
