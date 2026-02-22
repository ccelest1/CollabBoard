import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupBoardMocks, TEST_BOARD_ID, TEST_USER_ID } from "./fixtures/setupMocks";
import { getFreshBoardState, runAgentCommand } from "@/lib/ai/agent";

describe("Delete Commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Delete a SWOT analysis", async () => {
    const store = setupBoardMocks([
      { id: "f1", type: "frame", text: "Strengths", x: 0, y: 0, width: 200, height: 200 },
      { id: "f2", type: "frame", text: "Weaknesses", x: 220, y: 0, width: 200, height: 200 },
      { id: "f3", type: "frame", text: "Opportunities", x: 0, y: 220, width: 200, height: 200 },
      { id: "f4", type: "frame", text: "Threats", x: 220, y: 220, width: 200, height: 200 },
    ]);
    await runAgentCommand({
      command: "Delete the SWOT analysis",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    expect(store.getObjects()).toHaveLength(0);
  }, 15000);

  it("Delete all sticky notes", async () => {
    const store = setupBoardMocks([
      { id: "s1", type: "sticky", x: 0, y: 0, width: 150, height: 150 },
      { id: "s2", type: "sticky", x: 170, y: 0, width: 150, height: 150 },
      { id: "f1", type: "frame", x: 400, y: 0, width: 200, height: 200 },
    ]);
    await runAgentCommand({
      command: "Delete all sticky notes",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const remaining = store.getObjects();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.type).toBe("frame");
  }, 15000);

  it("Remove all pink sticky notes", async () => {
    const store = setupBoardMocks([
      { id: "s1", type: "sticky", color: "#FBCFE8", x: 0, y: 0, width: 150, height: 150 },
      { id: "s2", type: "sticky", color: "#FBCFE8", x: 170, y: 0, width: 150, height: 150 },
      { id: "s3", type: "sticky", color: "#FDE68A", x: 340, y: 0, width: 150, height: 150 },
    ]);
    await runAgentCommand({
      command: "Remove all pink sticky notes",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const remaining = store.getObjects();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.color).toMatch(/FDE68A|yellow/i);
  }, 15000);

  it("Clear the board", async () => {
    const store = setupBoardMocks([
      { id: "s1", type: "sticky", x: 0, y: 0, width: 150, height: 150 },
      { id: "f1", type: "frame", x: 200, y: 0, width: 200, height: 200 },
      { id: "r1", type: "rectangle", x: 500, y: 0, width: 150, height: 100 },
    ]);
    await runAgentCommand({
      command: "Clear the board",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    expect(store.getObjects()).toHaveLength(0);
  }, 15000);

  it("Delete the last object", async () => {
    const store = setupBoardMocks([
      { id: "s1", type: "sticky", x: 0, y: 0, width: 150, height: 150 },
      { id: "s2", type: "sticky", x: 170, y: 0, width: 150, height: 150 },
    ]);
    await runAgentCommand({
      command: "Delete the last object",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    expect(store.getObjects()).toHaveLength(1);
    expect(store.getObjects()[0]?.id).toBe("s1");
  }, 15000);

  it("Erase all frames", async () => {
    const store = setupBoardMocks([
      { id: "f1", type: "frame", x: 0, y: 0, width: 200, height: 200 },
      { id: "f2", type: "frame", x: 220, y: 0, width: 200, height: 200 },
      { id: "s1", type: "sticky", x: 440, y: 0, width: 150, height: 150 },
    ]);
    await runAgentCommand({
      command: "Erase all frames",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const remaining = store.getObjects();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.type).toBe("sticky");
  }, 15000);

  describe("Delete after create - board state freshness", () => {
    it("create then immediately delete sticky notes", async () => {
      const store = setupBoardMocks();

      await runAgentCommand({
        command: "Create 3 yellow sticky notes",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      expect(store.getObjects()).toHaveLength(3);

      await runAgentCommand({
        command: "Delete those sticky notes",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      expect(store.getObjects()).toHaveLength(0);
    }, 30000);

    it("create user journey map then delete it", async () => {
      const store = setupBoardMocks();

      await runAgentCommand({
        command: "Build a user journey map with 5 stages",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      expect(store.getObjects().length).toBeGreaterThan(0);

      await runAgentCommand({
        command: "Delete the user journey map",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      const remaining = store.getObjects();
      const journeyObjects = remaining.filter((object) => {
        const label = String(object.text ?? "").toLowerCase();
        return label.includes("stage") || label.includes("journey");
      });
      expect(journeyObjects).toHaveLength(0);
    }, 90000);

    it("create SWOT then delete SWOT - no new SWOT created", async () => {
      const store = setupBoardMocks();

      await runAgentCommand({
        command: "Create a SWOT analysis template with four quadrants",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      const afterCreate = store.getObjects().length;
      expect(afterCreate).toBe(4);

      await runAgentCommand({
        command: "Delete the SWOT analysis",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      expect(store.getObjects()).toHaveLength(0);
    }, 90000);
  });

  describe("Natural language delete variations", () => {
    const twoStickies = [
      { id: "s1", type: "sticky", color: "#FDE68A", text: "User Research", x: 0, y: 0, width: 150, height: 150 },
      { id: "s2", type: "sticky", color: "#FDE68A", text: "User Research", x: 170, y: 0, width: 150, height: 150 },
    ];

    it("delete those sticky notes", async () => {
      const store = setupBoardMocks(twoStickies);
      await runAgentCommand({
        command: "delete those sticky notes",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      expect(store.getObjects()).toHaveLength(0);
    }, 15000);

    it("remove those sticky notes", async () => {
      const store = setupBoardMocks(twoStickies);
      await runAgentCommand({
        command: "remove those sticky notes",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      expect(store.getObjects()).toHaveLength(0);
    }, 15000);

    it("get rid of the sticky notes", async () => {
      const store = setupBoardMocks(twoStickies);
      await runAgentCommand({
        command: "get rid of the sticky notes",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      expect(store.getObjects()).toHaveLength(0);
    }, 15000);

    it("delete the yellow sticky notes", async () => {
      const store = setupBoardMocks([
        ...twoStickies,
        { id: "s3", type: "sticky", color: "#FBCFE8", x: 340, y: 0, width: 150, height: 150 },
      ]);
      await runAgentCommand({
        command: "delete the yellow sticky notes",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      const remaining = store.getObjects();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.color).toMatch(/FBCFE8|pink/i);
    }, 15000);

    it("delete that - removes most recent object", async () => {
      const store = setupBoardMocks([
        { id: "s1", type: "sticky", createdAt: 1000, x: 0, y: 0, width: 150, height: 150 },
        { id: "s2", type: "sticky", createdAt: 2000, x: 170, y: 0, width: 150, height: 150 },
      ]);
      await runAgentCommand({
        command: "delete that",
        boardId: TEST_BOARD_ID,
        userId: TEST_USER_ID,
        userName: "test",
      });
      const remaining = store.getObjects();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe("s1");
    }, 15000);
  });

  describe("getFreshBoardState retries", () => {
    it("returns objects after delayed attempts", async () => {
      let callCount = 0;
      const handlers = {
        getBoardObjects: vi.fn(async () => {
          callCount += 1;
          if (callCount < 3) return [];
          return [{ id: "x1", type: "sticky", x: 0, y: 0, width: 150, height: 150 }];
        }),
      } as any;

      const result = await getFreshBoardState({
        boardId: "test-board",
        handlers,
      });
      expect(result.length).toBeGreaterThan(0);
      expect(callCount).toBeGreaterThanOrEqual(3);
    }, 10000);
  });
});
