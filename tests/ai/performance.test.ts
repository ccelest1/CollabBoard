import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupBoardMocks, TEST_BOARD_ID, TEST_USER_ID } from "./fixtures/setupMocks";
import { runAgentCommand } from "@/lib/ai/agent";

const TARGETS = {
  creation: 3000,
  manipulation: 10000,
  layout: 20000,
  complex: 45000,
};

async function timeCommand(command: string, _store: any) {
  const start = Date.now();
  await runAgentCommand({
    command,
    boardId: TEST_BOARD_ID,
    userId: TEST_USER_ID,
  });
  return Date.now() - start;
}

describe("Performance Targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Creation commands < 3s", () => {
    it(
      "Add a yellow sticky note",
      async () => {
        const store = setupBoardMocks();
        const ms = await timeCommand("Add a yellow sticky note that says 'User Research'", store);
        expect(ms).toBeLessThan(TARGETS.creation);
      },
      TARGETS.creation + 2000,
    );

    it(
      "Create a blue rectangle",
      async () => {
        const store = setupBoardMocks();
        const ms = await timeCommand("Create a blue rectangle at position 100, 200", store);
        expect(ms).toBeLessThan(TARGETS.creation);
      },
      TARGETS.creation + 2000,
    );

    it(
      "Add a frame",
      async () => {
        const store = setupBoardMocks();
        const ms = await timeCommand("Add a frame called 'Sprint Planning'", store);
        expect(ms).toBeLessThan(TARGETS.creation);
      },
      TARGETS.creation + 2000,
    );
  });

  describe("Manipulation commands < 10s", () => {
    it(
      "Move pink sticky notes",
      async () => {
        const store = setupBoardMocks([
          { id: "s1", type: "sticky", color: "#FBCFE8", x: 100, y: 100, width: 150, height: 150 },
        ]);
        const ms = await timeCommand("Move all the pink sticky notes to the right side", store);
        expect(ms).toBeLessThan(TARGETS.manipulation);
      },
      TARGETS.manipulation + 2000,
    );

    it(
      "Change color to green",
      async () => {
        const store = setupBoardMocks([
          { id: "s1", type: "sticky", color: "#FDE68A", x: 0, y: 0, width: 150, height: 150 },
        ]);
        const ms = await timeCommand("Change all sticky notes to green", store);
        expect(ms).toBeLessThan(TARGETS.manipulation);
      },
      TARGETS.manipulation + 2000,
    );
  });

  describe("Layout commands < 20s", () => {
    it(
      "Space elements evenly",
      async () => {
        const store = setupBoardMocks([
          { id: "s1", type: "sticky", x: 0, y: 0, width: 150, height: 150 },
          { id: "s2", type: "sticky", x: 900, y: 500, width: 150, height: 150 },
          { id: "s3", type: "sticky", x: 200, y: 800, width: 150, height: 150 },
        ]);
        const ms = await timeCommand("Space these elements evenly", store);
        expect(ms).toBeLessThan(TARGETS.layout);
      },
      TARGETS.layout + 2000,
    );

    it(
      "2x3 grid for pros and cons",
      async () => {
        const store = setupBoardMocks();
        const ms = await timeCommand("Create a 2x3 grid of sticky notes for pros and cons", store);
        expect(ms).toBeLessThan(TARGETS.layout);
      },
      TARGETS.layout + 2000,
    );
  });

  describe("Complex commands < 45s", () => {
    it(
      "SWOT analysis",
      async () => {
        const store = setupBoardMocks();
        const ms = await timeCommand("Create a SWOT analysis template with four quadrants", store);
        expect(ms).toBeLessThan(TARGETS.complex);
      },
      TARGETS.complex + 5000,
    );

    it(
      "Retrospective board",
      async () => {
        const store = setupBoardMocks();
        const ms = await timeCommand(
          "Set up a retrospective board with What Went Well, " + "What Didn't, and Action Items columns",
          store,
        );
        expect(ms).toBeLessThan(TARGETS.complex);
      },
      TARGETS.complex + 5000,
    );

    it(
      "User journey map",
      async () => {
        const store = setupBoardMocks();
        const ms = await timeCommand("Build a user journey map with 5 stages", store);
        expect(ms).toBeLessThan(TARGETS.complex);
      },
      TARGETS.complex + 5000,
    );
  });

  it("Delete SWOT analysis < 10s", async () => {
    setupBoardMocks([
      { id: "f1", type: "frame", text: "Strengths", x: 0, y: 0, width: 200, height: 200 },
      { id: "f2", type: "frame", text: "Weaknesses", x: 220, y: 0, width: 200, height: 200 },
      { id: "f3", type: "frame", text: "Opportunities", x: 0, y: 220, width: 200, height: 200 },
      { id: "f4", type: "frame", text: "Threats", x: 220, y: 220, width: 200, height: 200 },
    ]);
    const start = Date.now();
    await runAgentCommand({
      command: "Delete the SWOT analysis",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    expect(Date.now() - start).toBeLessThan(10000);
  }, 12000);

  it("Generate seven rectangles in a row < 30s", async () => {
    setupBoardMocks();
    const start = Date.now();
    await runAgentCommand({
      command: "Generate seven green rectangles in a row",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
    });
    expect(Date.now() - start).toBeLessThan(30000);
  }, 35000);
});
