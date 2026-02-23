import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const PlanStepSchema = z.object({
  id: z.number(),
  tool: z.enum([
    "createStickyNote",
    "createShape",
    "createFrame",
    "createConnector",
    "moveObject",
    "resizeObject",
    "updateText",
    "changeColor",
    "deleteObject",
    "getBoardState",
  ]),
  args: z.record(z.string(), z.unknown()),
  dependsOn: z.array(z.number()).default([]),
  label: z.string(),
});

const PlanSchema = z.object({
  intent: z.string(),
  steps: z.array(PlanStepSchema),
});

export type AgentPlan = z.infer<typeof PlanSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;

const PLANNER_SYSTEM_PROMPT = `CRITICAL: You MUST always return at least one step in the steps array.
Never return empty steps.
You are a board planning agent. Given a user command and current board state,
output ONLY a valid JSON plan. No prose, no markdown, no backticks.
The "intent" field must be a past-tense description of what was done, e.g. "created 3 sticky notes", "built a SWOT analysis", "deleted all frames".

Available tools:
- createStickyNote: { text, x, y, color } → returns { id }
- createShape: { type: "rectangle"|"circle", x, y, width, height, color } → returns { id }
- createFrame: { title, x, y, width, height } → returns { id }
- createConnector: { fromId, toId, style: "arrow"|"simple" } → returns { id }
- moveObject: { objectId, x, y } → returns { id }
- resizeObject: { objectId, width, height } → returns { id }
- updateText: { objectId, newText } → returns { id }
- changeColor: { objectId, color } → returns { id }
- deleteObject: { objectId } → returns { deleted, objectId }

Reference syntax: use "$step_N.id" to reference the id returned by step N.
Example: if step 0 creates a sticky note, step 1 can use objectId: "$step_0.id"

Color defaults: sticky=#fde68a, rectangle=#BFDBFE, circle=#a855f7, pink=#FBCFE8, green=#BBF7D0, blue=#BFDBFE
Size defaults: sticky=150x150, rectangle=150x100, circle=100x100, frame=400x300
Layout: place items at x=0,y=0 for first item, offset by width+20 for each subsequent
Board dimensions: 1200x800. "Right side" means x = 800. "Left side" means x = 50. "Top" means y = 50. "Bottom" means y = 700. Always use these exact values for directional moves.

Templates:
- SWOT: 4 createFrame calls: Strengths(0,0,200,200) Weaknesses(220,0,200,200)
  Opportunities(0,220,200,200) Threats(220,220,200,200)
- Retrospective: 3 createFrame calls: "What Went Well"(0,0,250,500)
  "What Didn't"(270,0,250,500) "Action Items"(540,0,250,500)
- Journey Map: 1 createFrame "User Journey Map"(0,0,920,220) +
  5 createStickyNote Stage 1-5 at x=20,198,376,554,732 y=40 color=#BFDBFE
- Pros/Cons Grid: 6 createStickyNote Pro1,Pro2,Pro3(green),Con1,Con2,Con3(pink)

For "delete it/them/those" after creating: reference the created step IDs.
For bulk operations: generate one step per object.
If command uses singular phrasing like "change the <object> color to ...", change exactly one matching object unless the user explicitly says "all", "every", or "each".
For "then" sequences: create steps in order with proper $step_N.id references.

Output format (MUST follow exactly):
{"intent":"brief description","steps":[{"id":0,"tool":"toolName","args":{...},"dependsOn":[],"label":"description"}]}

Example for "add a yellow sticky note":
{"intent":"Add a yellow sticky note","steps":[{"id":0,"tool":"createStickyNote","args":{"text":"","x":0,"y":0,"color":"#fde68a"},"dependsOn":[],"label":"Create sticky note"}]}

Current board state:
{{BOARD_STATE}}`;

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fenceMatch?.[1]?.trim() ?? trimmed;
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return unfenced.slice(firstBrace, lastBrace + 1);
  }
  return unfenced;
}

function readResponseText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return String(content ?? "");
}

export async function planCommand(params: {
  command: string;
  boardState: string;
  viewportCenter?: { x: number; y: number };
  modelName: string;
}): Promise<AgentPlan> {
  const model = new ChatOpenAI({
    modelName: params.modelName,
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const parsePlan = (raw: string) => {
    const normalizeCandidate = (candidate: unknown): unknown => {
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        if ("intent" in candidate && "steps" in candidate) {
          return candidate;
        }
      }

      const asArray = Array.isArray(candidate) ? candidate : [candidate];
      const steps = asArray
        .map((entry, index) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const [toolName, args] = Object.entries(entry as Record<string, unknown>)[0] ?? [];
          if (!toolName) return null;
          return {
            id: index,
            tool: toolName,
            args: (args as Record<string, unknown>) ?? {},
            dependsOn: [],
            label: `${toolName} step ${index + 1}`,
          };
        })
        .filter(Boolean);
      return {
        intent: params.command,
        steps,
      };
    };

    try {
      return PlanSchema.safeParse(normalizeCandidate(JSON.parse(raw)));
    } catch (error) {
      try {
        return PlanSchema.safeParse(normalizeCandidate(JSON.parse(`[${raw}]`)));
      } catch (secondError) {
        return {
          success: false as const,
          error:
            secondError instanceof Error ? secondError : error instanceof Error ? error : new Error("Invalid JSON from planner"),
        };
      }
    }
  };

  const originX = Math.round(params.viewportCenter?.x ?? 0);
  const originY = Math.round(params.viewportCenter?.y ?? 0);
  const anchorPlanToViewport = (plan: AgentPlan): AgentPlan => {
    const creationTools = new Set(["createStickyNote", "createShape", "createFrame", "createConnector"]);
    const firstCreation = plan.steps.find((step) => creationTools.has(step.tool));
    if (!firstCreation) return plan;

    const firstX = typeof firstCreation.args.x === "number" ? firstCreation.args.x : null;
    const firstY = typeof firstCreation.args.y === "number" ? firstCreation.args.y : null;
    if (firstX === null || firstY === null) return plan;

    const deltaX = originX - firstX;
    const deltaY = originY - firstY;
    if (deltaX === 0 && deltaY === 0) return plan;

    const shiftedSteps = plan.steps.map((step) => {
      if (!creationTools.has(step.tool)) return step;
      const nextArgs = { ...step.args };
      if (typeof nextArgs.x === "number") {
        nextArgs.x = nextArgs.x + deltaX;
      }
      if (typeof nextArgs.y === "number") {
        nextArgs.y = nextArgs.y + deltaY;
      }
      return { ...step, args: nextArgs };
    });

    return { ...plan, steps: shiftedSteps };
  };
  const enforceSingularColorChange = (plan: AgentPlan): AgentPlan => {
    const lowered = params.command.toLowerCase();
    const isSingularColorChange =
      /\bchange\s+the\b/.test(lowered) &&
      /\bcolor\s+to\b/.test(lowered) &&
      !/\b(all|every|each)\b/.test(lowered);
    if (!isSingularColorChange) return plan;

    let keptOne = false;
    const steps = plan.steps.filter((step) => {
      if (step.tool !== "changeColor") return true;
      if (!keptOne) {
        keptOne = true;
        return true;
      }
      return false;
    });
    return { ...plan, steps };
  };

  const systemPrompt = PLANNER_SYSTEM_PROMPT
    .replace("{{BOARD_STATE}}", params.boardState)
    .replace(
      "Layout: place items at x=0,y=0 for first item, offset by width+20 for each subsequent",
      `Layout: place items at x=${originX},y=${originY} for first item, offset by width+20 for each subsequent. For templates, offset all template coordinates by x=${originX}, y=${originY}.`,
    );
  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: params.command },
  ]);
  const rawText = stripMarkdownFences(readResponseText(response.content));
  const result = parsePlan(rawText);
  if (!result.success || result.data.steps.length === 0) {
    // retry once
    const retryResponse = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: params.command },
      { role: "assistant", content: rawText },
      { role: "user", content: "Your steps array was empty or invalid. You MUST return at least one step. Rewrite the complete plan now." },
    ]);
    const retryText = readResponseText(retryResponse.content).replace(/```json|```/g, "").trim();
    let retryResult;
    try {
      retryResult = PlanSchema.safeParse(JSON.parse(retryText));
    } catch {
      retryResult = parsePlan(stripMarkdownFences(retryText));
    }
    if (!retryResult.success || retryResult.data.steps.length === 0) {
      throw new Error("Planning failed");
    }
    return enforceSingularColorChange(anchorPlanToViewport(retryResult.data));
  }
  return enforceSingularColorChange(anchorPlanToViewport(result.data));
}

export function resolveStepArgs(
  args: Record<string, unknown>,
  stepResults: Record<number, unknown>,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      const idMatch = value.match(/^\$step_(\d+)\.id$/);
      if (idMatch) {
        const idx = Number(idMatch[1]);
        return (stepResults[idx] as any)?.id;
      }

      const idsMatch = value.match(/^\$step_(\d+)\.ids$/);
      if (idsMatch) {
        const idx = Number(idsMatch[1]);
        return (stepResults[idx] as any)?.ids;
      }

      return value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => walk(entry));
    }

    if (value && typeof value === "object") {
      const next: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        next[key] = walk(entry);
      }
      return next;
    }

    return value;
  };

  return walk(cloned) as Record<string, unknown>;
}
