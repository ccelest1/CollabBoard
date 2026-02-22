import { vi } from "vitest";
import { TEST_BOARD_ID, TEST_USER_ID, createMockBoardStore } from "./mockBoardStore";
import { createInMemoryHandlers } from "@/tests/ai/helpers/mockRuntime";
import { registerBoardMutationHandlers } from "@/lib/ai/agent";
import type { BoardObject } from "@/lib/boards/model";

export { TEST_BOARD_ID, TEST_USER_ID };

export function setupBoardMocks(initialObjects: any[] = []) {
  const store = createMockBoardStore(initialObjects);

  const normalizedSeed: BoardObject[] = initialObjects.map((item, index) => ({
    id: String(item.id ?? `seed-${index + 1}`),
    type: item.type ?? "sticky",
    x: Number(item.x ?? 0),
    y: Number(item.y ?? 0),
    width: Number(item.width ?? 150),
    height: Number(item.height ?? 150),
    color: String(item.color ?? "#fde68a"),
    text: item.text,
    parentFrameId: item.parentFrameId ?? item.parentId,
    createdAt: Number(item.createdAt ?? Date.now()),
    updatedAt: Number(item.updatedAt ?? Date.now()),
    updatedBy: String(item.updatedBy ?? TEST_USER_ID),
  }));
  const runtime = createInMemoryHandlers(normalizedSeed);
  registerBoardMutationHandlers({
    boardId: TEST_BOARD_ID,
    userId: TEST_USER_ID,
    handlers: runtime.handlers,
  });

  const syncRuntime = (nextObjects: any[]) => {
    runtime.objects.length = 0;
    runtime.objects.push(...(nextObjects as BoardObject[]));
  };

  return {
    ...store,
    save: vi.fn(async (_boardId: string, payload: any) => {
      const nextObjects = payload?.objects ?? [];
      syncRuntime(nextObjects);
      await store.save(_boardId, payload);
    }),
    load: vi.fn(async (_boardId: string) => {
      return { objects: runtime.objects };
    }),
    getObjects: () => runtime.objects,
    reset: () => {
      syncRuntime(normalizedSeed.map((obj) => ({ ...obj })));
      store.reset();
    },
  };
}
