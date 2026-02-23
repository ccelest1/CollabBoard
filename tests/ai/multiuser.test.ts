import { describe, expect, it, vi } from "vitest";
import type { BoardObject } from "@/lib/boards/model";
import type { BoardMutationHandlers } from "@/lib/ai/tools";
import { executeFakeAgentCommand } from "@/tests/ai/helpers/mockRuntime";

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: class {
    constructor(public options: Record<string, unknown>) {}
    async invoke() {
      const plan = {"intent":"mock","steps":[{"id":0,"tool":"createStickyNote","args":{"text":"Test","x":0,"y":0,"color":"#fde68a"},"dependsOn":[],"label":"create"}]};
      return { content: JSON.stringify(plan) };
    }
  },
}));

vi.mock("langsmith", () => ({
  Client: class {},
}));

vi.mock("@langchain/langgraph/prebuilt", () => ({
  createReactAgent: ({ tools }: { tools: Array<{ name: string; invoke: (input: unknown) => Promise<unknown> }> }) => ({
    invoke: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
      const userCommand = messages.find((m) => m.role === "user")?.content ?? "";
      return executeFakeAgentCommand(tools, userCommand);
    },
  }),
}));

import { registerBoardMutationHandlers, runAgentCommand } from "@/lib/ai/agent";

describe("multi-user concurrent AI commands", () => {
  it("handles two simultaneous users without overwrites and broadcasts both", async () => {
    const sharedObjects: BoardObject[] = [];
    const broadcastCalls: Array<{ userId: string; objectId: string }> = [];
    let seq = 0;

    const makeHandlers = (userId: string): BoardMutationHandlers => ({
      createStickyNote: ({ text, x, y, color }) => {
        seq += 1;
        const object: BoardObject = {
          id: `${userId}-${seq}`,
          type: "sticky",
          x,
          y,
          width: 150,
          height: 150,
          color,
          text,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          updatedBy: userId,
        };
        sharedObjects.push(object);
        broadcastCalls.push({ userId, objectId: object.id });
        return object;
      },
      createShape: vi.fn(),
      createFrame: vi.fn(),
      createConnector: vi.fn(),
      moveObject: vi.fn(),
      resizeObject: vi.fn(),
      updateText: vi.fn(),
      changeColor: vi.fn(),
      getBoardObjects: () => [...sharedObjects],
    });

    registerBoardMutationHandlers({
      boardId: "shared-board",
      userId: "alice",
      handlers: makeHandlers("alice"),
    });
    registerBoardMutationHandlers({
      boardId: "shared-board",
      userId: "bob",
      handlers: makeHandlers("bob"),
    });

    const [alice, bob] = await Promise.all([
      runAgentCommand({
        command: "Add a yellow sticky note that says User Research",
        boardId: "shared-board",
        userId: "alice",
      }),
      runAgentCommand({
        command: "Add a yellow sticky note that says User Research",
        boardId: "shared-board",
        userId: "bob",
      }),
    ]);

    expect(alice.summary.length).toBeGreaterThan(0);
    expect(bob.summary.length).toBeGreaterThan(0);
    expect(sharedObjects.length).toBeGreaterThanOrEqual(2);
    expect(sharedObjects.some((obj) => obj.updatedBy === "alice")).toBe(true);
    expect(sharedObjects.some((obj) => obj.updatedBy === "bob")).toBe(true);
    expect(broadcastCalls.some((call) => call.userId === "alice")).toBe(true);
    expect(broadcastCalls.some((call) => call.userId === "bob")).toBe(true);
  });
});
