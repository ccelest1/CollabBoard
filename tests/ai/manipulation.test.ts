import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupBoardMocks, TEST_BOARD_ID, TEST_USER_ID } from "./fixtures/setupMocks";
import { runAgentCommand } from "@/lib/ai/agent";

describe("Manipulation Commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Move all pink sticky notes to the right side", async () => {
    const store = setupBoardMocks([
      { id: "s1", type: "sticky", color: "#ec4899", x: 100, y: 100, width: 150, height: 150 },
      { id: "s2", type: "sticky", color: "#ff00ff", x: 200, y: 200, width: 150, height: 150 },
    ]);
    await runAgentCommand({
      command: "Move all the pink sticky notes to the right side",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const objects = store.getObjects();
    const pink = objects.filter(
      (o: any) =>
        String(o.color ?? "").toLowerCase() === "#ec4899" ||
        String(o.color ?? "").toLowerCase() === "#ff00ff" ||
        String(o.color ?? "").toLowerCase().includes("pink"),
    );
    pink.forEach((s: any) => expect(s.x).toBeGreaterThan(600));
  }, 15000);

  it("Change all sticky notes to green", async () => {
    const store = setupBoardMocks([{ id: "s1", type: "sticky", color: "#FDE68A", x: 0, y: 0, width: 150, height: 150 }]);
    await runAgentCommand({
      command: "Change all sticky notes to green",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const sticky = store.getObjects().find((o: any) => o.id === "s1");
    expect(sticky.color).toMatch(/green|57CC99|BBF7D0|22C55E/i);
  }, 15000);

  it("Resize the frame to fit its contents", async () => {
    const store = setupBoardMocks([
      { id: "f1", type: "frame", text: "Frame", x: 0, y: 0, width: 200, height: 200 },
      { id: "s1", type: "sticky", x: 10, y: 10, width: 150, height: 150, parentId: "f1" },
      { id: "s2", type: "sticky", x: 180, y: 180, width: 150, height: 150, parentId: "f1" },
    ]);
    await runAgentCommand({
      command: "Resize the frame to fit its contents",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const frame = store.getObjects().find((o: any) => o.id === "f1");
    expect(frame.width).toBeGreaterThanOrEqual(280);
    expect(frame.height).toBeGreaterThanOrEqual(280);
  }, 15000);

  it("Create a red sticky note and then make it black", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create a red sticky note and then make it black",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const objects = store.getObjects();
    expect(objects).toHaveLength(1);
    expect(objects[0]?.color).toMatch(/000000|black/i);
  }, 15000);

  it("Create 5 pink sticky notes and make them black", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create 5 pink sticky notes and make them black",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const objects = store.getObjects();
    expect(objects.length).toBeGreaterThanOrEqual(5);
    const blacks = objects.filter((o: any) =>
      /000000|0f172a|black/i.test(String(o.color ?? "")),
    );
    expect(blacks.length).toBeGreaterThanOrEqual(5);
  }, 30000);

  it("Create 10 rectangles and then delete them", async () => {
    const store = setupBoardMocks();
    await runAgentCommand({
      command: "Create 10 rectangles and then delete them",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    const objects = store.getObjects();
    expect(objects).toHaveLength(0);
  }, 30000);
});
