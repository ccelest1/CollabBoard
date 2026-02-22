import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupBoardMocks, TEST_BOARD_ID, TEST_USER_ID } from "./fixtures/setupMocks";
import { runAgentCommand } from "@/lib/ai/agent";

async function run(command: string, initial: any[] = []) {
  const store = setupBoardMocks(initial);
  await runAgentCommand({
    command,
    boardId: TEST_BOARD_ID,
    userId: TEST_USER_ID,
    userName: "test-user",
  });
  return store.getObjects();
}

describe("Creation variations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create 3 sticky notes", async () => {
    const objs = await run("create 3 sticky notes");
    expect(objs.filter((o: any) => o.type === "sticky")).toHaveLength(3);
  }, 20000);

  it("add three sticky notes", async () => {
    const objs = await run("add three sticky notes");
    expect(objs.filter((o: any) => o.type === "sticky")).toHaveLength(3);
  }, 20000);

  it("generate 3 sticky notes", async () => {
    const objs = await run("generate 3 sticky notes");
    expect(objs.filter((o: any) => o.type === "sticky")).toHaveLength(3);
  }, 20000);

  it("make 3 sticky notes", async () => {
    const objs = await run("make 3 sticky notes");
    expect(objs.filter((o: any) => o.type === "sticky")).toHaveLength(3);
  }, 20000);

  it("give me 3 sticky notes", async () => {
    const objs = await run("give me 3 sticky notes");
    expect(objs.filter((o: any) => o.type === "sticky")).toHaveLength(3);
  }, 20000);

  it("create seven green rectangles in a row", async () => {
    const objs = await run("create seven green rectangles in a row");
    const rects = objs.filter((o: any) => o.type === "rectangle" || o.type === "shape");
    expect(rects).toHaveLength(7);
    const ys = new Set(rects.map((r: any) => r.y));
    expect(ys.size).toBe(1);
  }, 45000);

  it("draw 4 blue circles", async () => {
    const objs = await run("draw 4 blue circles");
    const circles = objs.filter((o: any) => o.type === "circle");
    expect(circles).toHaveLength(4);
  }, 30000);

  it("place 5 orange frames", async () => {
    const objs = await run("place 5 orange frames");
    expect(objs.filter((o: any) => o.type === "frame")).toHaveLength(5);
  }, 45000);
});

describe("Delete variations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const swotBoard = [
    { id: "f1", type: "frame", text: "Strengths", x: 0, y: 0, width: 200, height: 200 },
    { id: "f2", type: "frame", text: "Weaknesses", x: 220, y: 0, width: 200, height: 200 },
    { id: "f3", type: "frame", text: "Opportunities", x: 0, y: 220, width: 200, height: 200 },
    { id: "f4", type: "frame", text: "Threats", x: 220, y: 220, width: 200, height: 200 },
  ];
  const mixedBoard = [
    { id: "s1", type: "sticky", color: "#FDE68A", x: 0, y: 0, width: 150, height: 150 },
    { id: "s2", type: "sticky", color: "#FBCFE8", x: 170, y: 0, width: 150, height: 150 },
    { id: "r1", type: "rectangle", x: 340, y: 0, width: 150, height: 100 },
    { id: "f1", type: "frame", text: "My Frame", x: 500, y: 0, width: 200, height: 200 },
  ];

  it("delete the SWOT analysis — must NOT create a new one", async () => {
    const objs = await run("delete the SWOT analysis", swotBoard);
    const swotFrames = objs.filter((o: any) =>
      ["strengths", "weaknesses", "opportunities", "threats"].some((k) => (o.text ?? "").toLowerCase().includes(k)),
    );
    expect(swotFrames).toHaveLength(0);
    expect(objs).toHaveLength(0);
  }, 15000);

  it("remove the SWOT analysis", async () => {
    const objs = await run("remove the SWOT analysis", swotBoard);
    expect(objs).toHaveLength(0);
  }, 15000);

  it("erase the SWOT board", async () => {
    const objs = await run("erase the SWOT board", swotBoard);
    expect(objs).toHaveLength(0);
  }, 15000);

  it("delete all sticky notes — leaves other objects", async () => {
    const objs = await run("delete all sticky notes", mixedBoard);
    expect(objs.filter((o: any) => o.type === "sticky" || o.type === "stickyNote")).toHaveLength(0);
    expect(objs.filter((o: any) => o.type === "rectangle" || o.type === "frame").length).toBeGreaterThan(0);
  }, 15000);

  it("remove all yellow sticky notes — leaves pink", async () => {
    const objs = await run("remove all yellow sticky notes", mixedBoard);
    const yellow = objs.filter((o: any) => (o.color ?? "").includes("FDE68A"));
    const pink = objs.filter((o: any) => (o.color ?? "").includes("FBCFE8"));
    expect(yellow).toHaveLength(0);
    expect(pink).toHaveLength(1);
  }, 15000);

  it("delete all frames — leaves stickies and shapes", async () => {
    const objs = await run("delete all frames", mixedBoard);
    expect(objs.filter((o: any) => o.type === "frame")).toHaveLength(0);
    expect(objs.filter((o: any) => o.type === "sticky")).toHaveLength(2);
  }, 15000);

  it("clear the board", async () => {
    const objs = await run("clear the board", mixedBoard);
    expect(objs).toHaveLength(0);
  }, 15000);

  it("delete everything", async () => {
    const objs = await run("delete everything", mixedBoard);
    expect(objs).toHaveLength(0);
  }, 15000);
});

describe("Inverse command pairs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create then delete sticky note", async () => {
    const store = setupBoardMocks();

    await runAgentCommand({
      command: "Add a yellow sticky note that says Test",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects()).toHaveLength(1);

    await runAgentCommand({
      command: "Delete all sticky notes",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects()).toHaveLength(0);
  }, 20000);

  it("create SWOT then delete SWOT", async () => {
    const store = setupBoardMocks();

    await runAgentCommand({
      command: "Create a SWOT analysis template with four quadrants",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects().filter((o: any) => o.type === "frame")).toHaveLength(4);

    await runAgentCommand({
      command: "Delete the SWOT analysis",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects()).toHaveLength(0);
  }, 60000);

  it("create 5 pink stickies then delete pink stickies", async () => {
    const store = setupBoardMocks();

    await runAgentCommand({
      command: "Create 5 pink sticky notes",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects()).toHaveLength(5);

    await runAgentCommand({
      command: "Remove all pink sticky notes",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects()).toHaveLength(0);
  }, 60000);

  it("change to green then change back to yellow", async () => {
    const store = setupBoardMocks([{ id: "s1", type: "sticky", color: "#FDE68A", x: 0, y: 0, width: 150, height: 150 }]);

    await runAgentCommand({
      command: "Change all sticky notes to green",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects()[0]?.color).toMatch(/22c55e|BBF7D0|57CC99|green/i);

    await runAgentCommand({
      command: "Change all sticky notes to yellow",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects()[0]?.color).toMatch(/FDE68A|F9C74F|yellow/i);
  }, 30000);
});

describe("Commands that must NOT cross-trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delete SWOT does not create SWOT", async () => {
    const store = setupBoardMocks([{ id: "f1", type: "frame", text: "Strengths", x: 0, y: 0, width: 200, height: 200 }]);
    const before = store.getObjects().length;
    await runAgentCommand({
      command: "Delete the SWOT analysis",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects().length).toBeLessThan(before);
  }, 15000);

  it("delete retrospective does not create retrospective", async () => {
    const store = setupBoardMocks([{ id: "f1", type: "frame", text: "What Went Well", x: 0, y: 0, width: 250, height: 500 }]);
    const before = store.getObjects().length;
    await runAgentCommand({
      command: "Delete the retrospective board",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    expect(store.getObjects().length).toBeLessThan(before);
  }, 15000);

  it("arrange grid does not affect frames", async () => {
    const store = setupBoardMocks([
      { id: "f1", type: "frame", x: 0, y: 0, width: 300, height: 300 },
      { id: "s1", type: "sticky", x: 500, y: 0, width: 150, height: 150 },
      { id: "s2", type: "sticky", x: 700, y: 0, width: 150, height: 150 },
    ]);
    await runAgentCommand({
      command: "Arrange these sticky notes in a grid",
      boardId: TEST_BOARD_ID,
      userId: TEST_USER_ID,
      userName: "test",
    });
    const frame = store.getObjects().find((o: any) => o.id === "f1");
    expect(frame?.x).toBe(0);
    expect(frame?.y).toBe(0);
  }, 20000);
});
