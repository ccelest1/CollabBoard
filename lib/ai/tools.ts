import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { BoardObject } from "@/lib/boards/model";
import { getBoardState, serializeBoardState, type SerializedBoardState } from "@/lib/ai/boardState";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPersistedBoardSnapshot, savePersistedBoardSnapshot } from "@/lib/supabase/boardStateStore";

type CreateStickyNoteInput = {
  text: string;
  x: number;
  y: number;
  color: string;
};

type CreateShapeInput = {
  type: "rectangle" | "circle";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

type CreateFrameInput = {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type CreateConnectorInput = {
  fromId: string;
  toId: string;
  style: "arrow" | "simple";
};

type MoveObjectInput = {
  objectId: string;
  x: number;
  y: number;
};

type ResizeObjectInput = {
  objectId: string;
  width: number;
  height: number;
};

type UpdateTextInput = {
  objectId: string;
  newText: string;
};

type ChangeColorInput = {
  objectId: string;
  color: string;
};

type DeleteObjectInput = {
  objectId: string;
};

export function calculateCenteredGridPositions(params: {
  count: number;
  itemWidth: number;
  itemHeight: number;
  gap: number;
  preferredCols?: number;
}): Array<{ x: number; y: number }> {
  const count = Math.max(0, Math.floor(params.count));
  if (count === 0) return [];
  const cols = Math.max(1, Math.floor(params.preferredCols ?? Math.ceil(Math.sqrt(count))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const totalWidth = cols * params.itemWidth + (cols - 1) * params.gap;
  const totalHeight = rows * params.itemHeight + (rows - 1) * params.gap;
  const startX = -(totalWidth / 2);
  const startY = -(totalHeight / 2);
  const positions: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions.push({
      x: startX + col * (params.itemWidth + params.gap),
      y: startY + row * (params.itemHeight + params.gap),
    });
  }
  return positions;
}

export type BoardMutationHandlers = {
  createStickyNote: (input: CreateStickyNoteInput) => Promise<BoardObject> | BoardObject;
  createShape: (input: CreateShapeInput) => Promise<BoardObject> | BoardObject;
  createFrame: (input: CreateFrameInput) => Promise<BoardObject> | BoardObject;
  createConnector: (input: CreateConnectorInput) => Promise<BoardObject> | BoardObject;
  moveObject: (input: MoveObjectInput) => Promise<BoardObject> | BoardObject;
  resizeObject: (input: ResizeObjectInput) => Promise<BoardObject> | BoardObject;
  updateText: (input: UpdateTextInput) => Promise<BoardObject> | BoardObject;
  changeColor: (input: ChangeColorInput) => Promise<BoardObject> | BoardObject;
  deleteObject?: (input: DeleteObjectInput) => Promise<{ deleted: boolean; objectId: string }> | { deleted: boolean; objectId: string };
  getBoardObjects: () => Promise<BoardObject[]> | BoardObject[];
};

export type ToolContext = {
  boardId: string;
  userId: string;
  supabase?: SupabaseClient;
};

const colorSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Expected a hex color like #fde68a");

const createStickyNoteSchema = z.object({
  text: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  color: colorSchema,
});

const createShapeSchema = z.object({
  type: z.enum(["rectangle", "circle"]),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  color: colorSchema,
});

const createFrameSchema = z.object({
  title: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const createConnectorSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  style: z.enum(["arrow", "simple"]),
});

const moveObjectSchema = z.object({
  objectId: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
});

const resizeObjectSchema = z.object({
  objectId: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
});

const updateTextSchema = z.object({
  objectId: z.string().min(1),
  newText: z.string(),
});

const changeColorSchema = z.object({
  objectId: z.string().min(1),
  color: colorSchema,
});

const deleteObjectSchema = z.object({
  objectId: z.string().min(1),
});

const getBoardStateSchema = z.object({});

function toSerializableBoardObject(object: BoardObject): BoardObject {
  return {
    ...object,
  };
}

export function createBoardTools(handlers: BoardMutationHandlers, context?: ToolContext) {
  const createStickyNote = tool(
    async (input): Promise<BoardObject> => {
      const created = await handlers.createStickyNote(input);
      return toSerializableBoardObject(created);
    },
    {
      name: "createStickyNote",
      description: "Create a sticky note at absolute board coordinates.",
      schema: createStickyNoteSchema,
    },
  );

  const createShape = tool(
    async (input): Promise<BoardObject> => {
      const created = await handlers.createShape(input);
      return toSerializableBoardObject(created);
    },
    {
      name: "createShape",
      description: "Create a rectangle or circle shape at absolute coordinates.",
      schema: createShapeSchema,
    },
  );

  const createFrame = tool(
    async (input): Promise<BoardObject> => {
      const created = await handlers.createFrame(input);
      return toSerializableBoardObject(created);
    },
    {
      name: "createFrame",
      description: "Create a frame object with title and bounds.",
      schema: createFrameSchema,
    },
  );

  const createConnector = tool(
    async (input): Promise<BoardObject> => {
      const created = await handlers.createConnector(input);
      return toSerializableBoardObject(created);
    },
    {
      name: "createConnector",
      description: "Create a connector line between two board objects.",
      schema: createConnectorSchema,
    },
  );

  const moveObject = tool(
    async (input): Promise<BoardObject> => {
      const updated = await handlers.moveObject(input);
      return toSerializableBoardObject(updated);
    },
    {
      name: "moveObject",
      description: "Move an existing object to new absolute coordinates.",
      schema: moveObjectSchema,
    },
  );

  const resizeObject = tool(
    async (input): Promise<BoardObject> => {
      const updated = await handlers.resizeObject(input);
      return toSerializableBoardObject(updated);
    },
    {
      name: "resizeObject",
      description: "Resize an existing object with new width and height.",
      schema: resizeObjectSchema,
    },
  );

  const updateText = tool(
    async (input): Promise<BoardObject> => {
      const updated = await handlers.updateText(input);
      return toSerializableBoardObject(updated);
    },
    {
      name: "updateText",
      description: "Update text content for a text-capable board object.",
      schema: updateTextSchema,
    },
  );

  const changeColor = tool(
    async (input): Promise<BoardObject> => {
      const updated = await handlers.changeColor(input);
      return toSerializableBoardObject(updated);
    },
    {
      name: "changeColor",
      description: "Change fill or stroke color for a board object.",
      schema: changeColorSchema,
    },
  );

  const deleteObject = tool(
    async (input): Promise<{ deleted: boolean; objectId: string }> => {
      if (handlers.deleteObject) {
        return handlers.deleteObject(input);
      }
      if (!context?.supabase) {
        throw new Error("deleteObject requires either handlers.deleteObject or a Supabase context");
      }
      const current = await loadPersistedBoardSnapshot(context.supabase, context.boardId);
      const updated = {
        ...current,
        objects: (current.objects ?? []).filter((object) => object.id !== input.objectId),
      };
      await savePersistedBoardSnapshot(context.supabase, context.boardId, updated);
      console.log("[delete] removed object:", input.objectId);
      return { deleted: true, objectId: input.objectId };
    },
    {
      name: "deleteObject",
      description: "Delete an object from the board by its id. Call getBoardState first to find the id.",
      schema: deleteObjectSchema,
    },
  );

  const getBoardStateTool = tool(
    async (): Promise<SerializedBoardState> => {
      if (context?.supabase) {
        return getBoardState(context.supabase, context.boardId);
      }
      const objects = await handlers.getBoardObjects();
      return serializeBoardState(objects);
    },
    {
      name: "getBoardState",
      description: "Get the full board state with absolute positions and parent relationships.",
      schema: getBoardStateSchema,
    },
  );

  return {
    createStickyNote,
    createShape,
    createFrame,
    createConnector,
    moveObject,
    resizeObject,
    updateText,
    changeColor,
    deleteObject,
    getBoardState: getBoardStateTool,
  };
}

export function buildTools(context: { boardId: string; userId: string; supabase: SupabaseClient; handlers: BoardMutationHandlers }) {
  return createBoardTools(context.handlers, {
    boardId: context.boardId,
    userId: context.userId,
    supabase: context.supabase,
  });
}
