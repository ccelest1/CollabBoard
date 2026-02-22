import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentCommand } from "@/lib/ai/agent";
import { setupBoardMocks, TEST_BOARD_ID, TEST_USER_ID } from "./fixtures/setupMocks";

describe("Layout Commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Arrange in grid only moves sticky notes", async () => {
    const store = setupBoardMocks([
      { id: "f1", type: "frame", x: 0, y: 0, width: 300, height: 300 },
      { id: "s1", type: "sticky", x: 500, y: 300, width: 150, height: 150 },
      { id: "s2", type: "sticky", x: 100, y: 600, width: 150, height: 150 },
      { id: "s3", type: "sticky", x: 800, y: 100, width: 150, height: 150 },
    ]);

    await runAgentCommand({
      command: "Arrange these sticky notes in a grid",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });

    const objects = store.getObjects();
    const frame = objects.find((object: any) => object.id === "f1");
    expect(frame?.x).toBe(0);
    expect(frame?.y).toBe(0);

    const stickies = objects.filter((object: any) => object.type === "sticky");
    expect(stickies).toHaveLength(3);
    const xs = stickies.map((sticky: any) => sticky.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(400);
  }, 20000);
});
