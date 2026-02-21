import { describe, expect, it, vi } from "vitest";
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

const LATENCY_TARGETS = {
  creation: 3000,
  manipulation: 10000,
  layout: 15000,
  complex: 30000,
};

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

describe("AI command performance thresholds", () => {
  describe("creation latency", () => {
    const commands = [
      "Add a yellow sticky note that says User Research",
      "Create a blue rectangle at position 100, 200",
      "Add a frame called Sprint Planning",
    ];
    commands.forEach((command, index) => {
      it(`completes in < 3s: "${command}"`, async () => {
        const runtime = createInMemoryHandlers();
        registerBoardMutationHandlers({ boardId: `perf-create-${index}`, userId: "perf-user", handlers: runtime.handlers });
        const start = Date.now();
        await runAgentCommand({ command, boardId: `perf-create-${index}`, userId: "perf-user" });
        expect(Date.now() - start).toBeLessThan(LATENCY_TARGETS.creation);
      });
    });
  });

  describe("manipulation latency", () => {
    const commands = [
      "Move all the pink sticky notes to the right side",
      "Resize the frame to fit its contents",
      "Change all sticky notes to green",
    ];
    commands.forEach((command, index) => {
      it(`completes in < 10s: "${command}"`, async () => {
        const runtime = createInMemoryHandlers([
          seedObject({ id: "frame-1", type: "frame", width: 200, height: 200, text: "Frame" }),
          seedObject({ id: "pink-1", type: "sticky", color: "#ec4899", x: 10, y: 20 }),
          seedObject({ id: "pink-2", type: "sticky", color: "#ff00ff", x: 60, y: 30 }),
          seedObject({ id: "child-1", type: "sticky", parentFrameId: "frame-1", x: 30, y: 30 }),
        ]);
        registerBoardMutationHandlers({ boardId: `perf-manip-${index}`, userId: "perf-user", handlers: runtime.handlers });
        const start = Date.now();
        await runAgentCommand({ command, boardId: `perf-manip-${index}`, userId: "perf-user" });
        expect(Date.now() - start).toBeLessThan(LATENCY_TARGETS.manipulation);
      });
    });
  });

  describe("layout latency", () => {
    const commands = [
      "Arrange these sticky notes in a grid",
      "Create a 2x3 grid of sticky notes for pros and cons",
      "Space these elements evenly",
    ];
    commands.forEach((command, index) => {
      it(`completes in < 15s: "${command}"`, async () => {
        const runtime = createInMemoryHandlers(
          Array.from({ length: 6 }).map((_, seedIndex) =>
            seedObject({ id: `seed-${seedIndex + 1}`, type: "sticky", x: 500, y: 500 }),
          ),
        );
        registerBoardMutationHandlers({ boardId: `perf-layout-${index}`, userId: "perf-user", handlers: runtime.handlers });
        const start = Date.now();
        await runAgentCommand({ command, boardId: `perf-layout-${index}`, userId: "perf-user" });
        expect(Date.now() - start).toBeLessThan(LATENCY_TARGETS.layout);
      });
    });
  });

  describe("complex latency", () => {
    const commands = [
      "Create a SWOT analysis template with four quadrants",
      "Build a user journey map with 5 stages",
      "Set up a retrospective board with What Went Well, What Didn't, and Action Items",
    ];
    commands.forEach((command, index) => {
      it(`completes in < 30s: "${command}"`, async () => {
        const runtime = createInMemoryHandlers();
        registerBoardMutationHandlers({ boardId: `perf-complex-${index}`, userId: "perf-user", handlers: runtime.handlers });
        const start = Date.now();
        await runAgentCommand({ command, boardId: `perf-complex-${index}`, userId: "perf-user" });
        expect(Date.now() - start).toBeLessThan(LATENCY_TARGETS.complex);
      });
    });
  });
});
