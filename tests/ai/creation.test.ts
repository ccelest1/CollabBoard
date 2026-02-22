import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupBoardMocks, TEST_BOARD_ID, TEST_USER_ID } from "./fixtures/setupMocks";
import { runAgentCommand } from "@/lib/ai/agent";

describe("Creation Commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Add a yellow sticky note that says User Research", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Add a yellow sticky note that says 'User Research'",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const sticky = store.getObjects().find((o: any) => o.type === "sticky" || o.type === "stickyNote");
    expect(sticky).toBeDefined();
    expect(sticky.text).toBe("User Research");
    expect(sticky.color).toMatch(/yellow|FDE68A|F9C74F|#fde68a/i);
  }, 10000);

  it("Create a blue rectangle at position 100, 200", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create a blue rectangle at position 100, 200",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const rect = store.getObjects().find((o: any) => o.type === "rectangle" || o.type === "shape");
    expect(rect).toBeDefined();
    expect(rect.x).toBe(100);
    expect(rect.y).toBe(200);
    expect(rect.color).toMatch(/blue|74B3F0|BFDBFE|3B82F6/i);
  }, 10000);

  it("Add a frame called Sprint Planning", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Add a frame called 'Sprint Planning'",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const frame = store.getObjects().find((o: any) => o.type === "frame");
    expect(frame).toBeDefined();
    expect(frame.text).toBe("Sprint Planning");
  }, 10000);

  it("Create 5 pink sticky notes", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create 5 pink sticky notes",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const stickies = store
      .getObjects()
      .filter((o: any) => o.type === "sticky" || o.type === "stickyNote");
    expect(stickies).toHaveLength(5);
    stickies.forEach((sticky: any) => {
      expect(sticky.color).toMatch(/FBCFE8|F4A0C0|pink/i);
    });
  }, 30000);

  it("Create 10 rectangles", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create 10 rectangles",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const rects = store
      .getObjects()
      .filter((o: any) => o.type === "rectangle" || o.type === "shape");
    expect(rects).toHaveLength(10);
  }, 60000);

  it("Generate seven green rectangles in a row", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Generate seven green rectangles in a row",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const rects = store.getObjects().filter((o: any) => o.type === "rectangle" || o.type === "shape");
    expect(rects).toHaveLength(7);
    const ys = rects.map((r: any) => r.y);
    const uniqueYs = new Set(ys);
    expect(uniqueYs.size).toBe(1);
    rects.forEach((r: any) => {
      expect(r.color).toMatch(/BBF7D0|57CC99|green/i);
    });
  }, 60000);

  it("Draw 3 blue circles", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Draw 3 blue circles",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const circles = store.getObjects().filter((o: any) => o.type === "circle");
    expect(circles).toHaveLength(3);
    circles.forEach((c: any) => {
      expect(c.color).toMatch(/BFDBFE|74B3F0|blue/i);
    });
  }, 30000);

  it("Give me five sticky notes", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Give me five sticky notes",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const stickies = store.getObjects().filter((o: any) => o.type === "sticky" || o.type === "stickyNote");
    expect(stickies).toHaveLength(5);
  }, 30000);

  it("Create 10 frames", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create 10 frames",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const frames = store.getObjects().filter((o: any) => o.type === "frame");
    expect(frames).toHaveLength(10);
  }, 60000);
});
