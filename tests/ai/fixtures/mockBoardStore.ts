import { vi } from "vitest";

export const TEST_BOARD_ID = "test-board-001";
export const TEST_USER_ID = "test-user-001";

export function createMockBoardStore(initialObjects: any[] = []) {
  let objects = [...initialObjects];

  return {
    getObjects: () => objects,
    reset: () => {
      objects = [...initialObjects];
    },
    save: vi.fn(async (_boardId: string, payload: any) => {
      objects = payload.objects ?? [];
    }),
    load: vi.fn(async (_boardId: string) => ({ objects: [...objects] })),
  };
}
