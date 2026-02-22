import { describe, it, expect } from "vitest";
import { setupBoardMocks, TEST_BOARD_ID } from "./fixtures/setupMocks";

describe("Test infrastructure", () => {
  it("mock board store works", async () => {
    const store = setupBoardMocks([{ id: "1", type: "sticky", text: "test" }]);
    expect(store.getObjects()).toHaveLength(1);
    await store.save(TEST_BOARD_ID, { objects: [] });
    expect(store.getObjects()).toHaveLength(0);
  });
});
