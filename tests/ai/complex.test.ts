import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupBoardMocks, TEST_BOARD_ID, TEST_USER_ID } from "./fixtures/setupMocks";
import { runAgentCommand } from "@/lib/ai/agent";

describe("Complex Command Variations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Build a SWOT analysis (variation)", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Build a SWOT analysis",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const frames = store.getObjects().filter((o: any) => o.type === "frame");
    expect(frames).toHaveLength(4);
  }, 45000);

  it("Set up a sprint retrospective (variation)", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Set up a sprint retrospective",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const frames = store.getObjects().filter((o: any) => o.type === "frame");
    expect(frames.length).toBeGreaterThanOrEqual(3);
  }, 60000);

  it("Create a customer journey map (variation)", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create a customer journey map with 5 stages",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const stickies = store.getObjects().filter((o: any) => o.type === "sticky" || o.type === "stickyNote");
    expect(stickies.length).toBeGreaterThanOrEqual(5);
  }, 60000);

  it("Create a SWOT analysis and then delete it", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create a SWOT analysis and then delete it",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const objects = store.getObjects();
    expect(objects).toHaveLength(0);
  }, 30000);

  it("Create a journey map with 5 stages and then delete it", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create a journey map with 5 stages and then delete it",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const objects = store.getObjects();
    expect(objects).toHaveLength(0);
  }, 30000);
});
