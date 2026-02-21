import type { BoardObject } from "@/lib/boards/model";
import type { BoardMutationHandlers } from "@/lib/ai/tools";

type StructuredToolLike = {
  name: string;
  invoke: (input: unknown) => Promise<unknown>;
};

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `obj-${idSeq}`;
}

export function createInMemoryHandlers(seed: BoardObject[] = []) {
  const objects = [...seed];
  const broadcasts: Array<{ userId: string; objectId: string }> = [];

  const find = (id: string) => objects.find((item) => item.id === id);
  const touch = (object: BoardObject, userId: string) => {
    object.updatedAt = Date.now();
    object.updatedBy = userId;
    broadcasts.push({ userId, objectId: object.id });
  };

  const handlers: BoardMutationHandlers = {
    createStickyNote: ({ text, x, y, color }) => {
      const now = Date.now();
      const object: BoardObject = {
        id: nextId(),
        type: "sticky",
        x,
        y,
        width: 150,
        height: 150,
        text,
        color,
        createdAt: now,
        updatedAt: now,
        updatedBy: "test-user",
      };
      objects.push(object);
      broadcasts.push({ userId: object.updatedBy, objectId: object.id });
      return object;
    },
    createShape: ({ type, x, y, width, height, color }) => {
      const now = Date.now();
      const object: BoardObject = {
        id: nextId(),
        type,
        x,
        y,
        width,
        height,
        color,
        createdAt: now,
        updatedAt: now,
        updatedBy: "test-user",
      };
      objects.push(object);
      broadcasts.push({ userId: object.updatedBy, objectId: object.id });
      return object;
    },
    createFrame: ({ title, x, y, width, height }) => {
      const now = Date.now();
      const object: BoardObject = {
        id: nextId(),
        type: "frame",
        x,
        y,
        width,
        height,
        text: title,
        color: "rgba(200, 200, 200, 0.1)",
        createdAt: now,
        updatedAt: now,
        updatedBy: "test-user",
      };
      objects.push(object);
      broadcasts.push({ userId: object.updatedBy, objectId: object.id });
      return object;
    },
    createConnector: ({ fromId, toId, style }) => {
      const from = find(fromId);
      const to = find(toId);
      if (!from || !to) throw new Error("missing connector endpoint");
      const now = Date.now();
      const object: BoardObject = {
        id: nextId(),
        type: "line",
        x: from.x,
        y: from.y,
        x2: to.x,
        y2: to.y,
        width: Math.max(1, Math.abs(to.x - from.x)),
        height: Math.max(1, Math.abs(to.y - from.y)),
        color: "#111827",
        lineStyle: style,
        startObjectId: fromId,
        endObjectId: toId,
        createdAt: now,
        updatedAt: now,
        updatedBy: "test-user",
      };
      objects.push(object);
      broadcasts.push({ userId: object.updatedBy, objectId: object.id });
      return object;
    },
    moveObject: ({ objectId, x, y }) => {
      const object = find(objectId);
      if (!object) throw new Error("missing object");
      object.x = x;
      object.y = y;
      touch(object, "test-user");
      return object;
    },
    resizeObject: ({ objectId, width, height }) => {
      const object = find(objectId);
      if (!object) throw new Error("missing object");
      object.width = width;
      object.height = height;
      touch(object, "test-user");
      return object;
    },
    updateText: ({ objectId, newText }) => {
      const object = find(objectId);
      if (!object) throw new Error("missing object");
      object.text = newText;
      touch(object, "test-user");
      return object;
    },
    changeColor: ({ objectId, color }) => {
      const object = find(objectId);
      if (!object) throw new Error("missing object");
      object.color = color;
      touch(object, "test-user");
      return object;
    },
    getBoardObjects: () => objects.map((item) => ({ ...item })),
  };

  return { handlers, objects, broadcasts };
}

export async function executeFakeAgentCommand(tools: StructuredToolLike[], command: string) {
  const lowered = command.toLowerCase();
  const toolMessages: Array<{ type: "tool"; content: unknown }> = [];
  const callTool = async (name: string, input: unknown) => {
    const tool = tools.find((item) => item.name === name);
    if (!tool) throw new Error(`tool not found: ${name}`);
    const content = await tool.invoke(input);
    toolMessages.push({ type: "tool", content });
    return content;
  };

  if (lowered.includes("swot")) {
    await callTool("createFrame", { title: "Strengths", x: 0, y: 0, width: 200, height: 200 });
    await callTool("createFrame", { title: "Weaknesses", x: 220, y: 0, width: 200, height: 200 });
    await callTool("createFrame", { title: "Opportunities", x: 0, y: 220, width: 200, height: 200 });
    await callTool("createFrame", { title: "Threats", x: 220, y: 220, width: 200, height: 200 });
    return {
      messages: [...toolMessages, { type: "ai", content: "Created SWOT analysis template." }],
    };
  }

  if (lowered.includes("retrospective")) {
    await callTool("createFrame", { title: "What Went Well", x: 0, y: 0, width: 200, height: 400 });
    await callTool("createFrame", { title: "What Didn't", x: 220, y: 0, width: 200, height: 400 });
    await callTool("createFrame", { title: "Action Items", x: 440, y: 0, width: 200, height: 400 });
    return {
      messages: [...toolMessages, { type: "ai", content: "Created retrospective board." }],
    };
  }

  if (lowered.includes("2x3 grid")) {
    const labels = ["Pro 1", "Con 1", "Pro 2", "Con 2", "Pro 3", "Con 3"];
    for (let i = 0; i < 6; i += 1) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      await callTool("createStickyNote", {
        text: labels[i],
        x: col * (150 + 20),
        y: row * (150 + 20),
        color: "#fde68a",
      });
    }
    return {
      messages: [...toolMessages, { type: "ai", content: "Created 2x3 sticky note grid." }],
    };
  }

  if (lowered.includes("arrange in a grid")) {
    const state = (await callTool("getBoardState", {})) as { objects: BoardObject[] };
    for (let i = 0; i < state.objects.length; i += 1) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const object = state.objects[i];
      await callTool("moveObject", {
        objectId: object.id,
        x: col * (object.width + 20),
        y: row * (object.height + 20),
      });
    }
    return {
      messages: [...toolMessages, { type: "ai", content: "Arranged items in a grid." }],
    };
  }

  if (lowered.includes("move all sticky notes to the right side")) {
    const state = (await callTool("getBoardState", {})) as { objects: BoardObject[] };
    const sticky = state.objects.filter((item) => item.type === "sticky");
    for (const object of sticky) {
      await callTool("moveObject", {
        objectId: object.id,
        x: object.x + 300,
        y: object.y,
      });
    }
    return {
      messages: [...toolMessages, { type: "ai", content: "Moved sticky notes to the right side." }],
    };
  }

  if (lowered.includes("yellow sticky note")) {
    await callTool("createStickyNote", {
      text: "User Research",
      x: 0,
      y: 0,
      color: "#facc15",
    });
    return {
      messages: [...toolMessages, { type: "ai", content: "Added yellow sticky note." }],
    };
  }

  await callTool("createStickyNote", {
    text: "Default",
    x: 0,
    y: 0,
    color: "#fde68a",
  });
  return {
    messages: [...toolMessages, { type: "ai", content: "Created default sticky note." }],
  };
}
