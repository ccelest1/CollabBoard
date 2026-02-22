export type Intent =
  | "delete"
  | "create_bulk"
  | "create_single"
  | "swot"
  | "retrospective"
  | "journey_map"
  | "grid_template"
  | "arrange_grid"
  | "space_evenly"
  | "move_objects"
  | "change_color"
  | "resize"
  | "create_then_modify"
  | "invalid"
  | "unknown";

const VERB_GROUPS = {
  create: [
    "create",
    "add",
    "make",
    "build",
    "generate",
    "draw",
    "place",
    "put",
    "give me",
    "show",
    "produce",
    "insert",
    "new",
    "spawn",
    "duplicate",
    "copy",
    "set up",
    "setup",
  ],
  delete: [
    "delete",
    "remove",
    "erase",
    "clear",
    "destroy",
    "wipe",
    "get rid of",
    "trash",
    "discard",
    "eliminate",
    "drop",
  ],
  move: ["move", "shift", "push", "send", "drag", "relocate", "reposition", "transfer", "put", "place"],
  arrange: ["arrange", "organize", "sort", "order", "layout", "lay out", "distribute", "spread", "align", "structure", "group"],
  change: ["change", "update", "set", "make", "turn", "convert", "switch", "transform", "alter", "modify", "edit"],
  resize: ["resize", "scale", "fit", "expand", "shrink", "grow", "adjust size", "make bigger", "make smaller", "stretch"],
} as const;

function hasVerb(text: string, group: readonly string[]) {
  return group.some((verb) => text.includes(verb));
}

export function classifyIntent(command: string): Intent {
  const lowered = command.toLowerCase().trim();
  if (lowered.length < 3) return "invalid";

  const boardNouns = [
    "sticky",
    "note",
    "frame",
    "rectangle",
    "square",
    "circle",
    "arrow",
    "connector",
    "text",
    "shape",
    "board",
    "swot",
    "retro",
    "journey",
    "grid",
    "element",
    "object",
    "item",
    "quadrant",
    "strength",
    "strengths",
    "weakness",
    "weaknesses",
    "stage",
    "column",
    "everything",
    "all",
    "those",
    "them",
    "these",
    "that",
    "it",
  ];
  const hasNoun = boardNouns.some((noun) => lowered.includes(noun));
  if (!hasNoun) return "invalid";

  if (hasVerb(lowered, VERB_GROUPS.delete)) return "delete";

  const hasCreateVerb = hasVerb(lowered, VERB_GROUPS.create);
  const hasChangeVerb = hasVerb(lowered, VERB_GROUPS.change);
  const hasSequenceWord =
    lowered.includes("and then") || lowered.includes("then ") || lowered.includes("and make") || lowered.includes("and change");
  if (hasCreateVerb && hasChangeVerb && hasSequenceWord) {
    return "create_then_modify";
  }

  if (hasCreateVerb || lowered.includes("i need") || lowered.includes("i want")) {
    if (lowered.includes("swot") || (lowered.includes("strength") && lowered.includes("weakness")) || lowered.includes("quadrant")) {
      return "swot";
    }
    if (
      lowered.includes("retro") ||
      lowered.includes("retrospective") ||
      lowered.includes("went well") ||
      lowered.includes("sprint review")
    ) {
      return "retrospective";
    }
    if (lowered.includes("journey") || (lowered.includes("user") && lowered.includes("stage"))) {
      return "journey_map";
    }
    if (lowered.includes("pros") && lowered.includes("cons")) {
      return "grid_template";
    }
  }

  const hasBulkPattern =
    /(?:create|add|make|draw|generate|build|place|put|give me|show|produce)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(
      lowered,
    );
  if (hasCreateVerb && hasBulkPattern) return "create_bulk";
  if (hasCreateVerb) return "create_single";

  if (hasVerb(lowered, VERB_GROUPS.arrange)) {
    if (lowered.includes("grid")) return "arrange_grid";
    if (lowered.includes("even") || lowered.includes("equal") || lowered.includes("space") || lowered.includes("distribut")) {
      return "space_evenly";
    }
  }
  if (lowered.includes("space") && lowered.includes("even")) return "space_evenly";

  if (
    hasVerb(lowered, VERB_GROUPS.move) &&
    (lowered.includes("right") || lowered.includes("left") || lowered.includes("top") || lowered.includes("bottom") || lowered.includes("side"))
  ) {
    return "move_objects";
  }

  if (hasVerb(lowered, VERB_GROUPS.change) && lowered.includes("color")) return "change_color";
  if (
    hasVerb(lowered, VERB_GROUPS.change) &&
    ["red", "blue", "green", "yellow", "pink", "orange", "purple", "black", "white"].some((c) => lowered.includes(c))
  ) {
    return "change_color";
  }
  if (lowered.includes("turn") && ["red", "blue", "green", "yellow", "pink", "orange", "purple", "black", "white"].some((c) => lowered.includes(c))) {
    return "change_color";
  }

  if (hasVerb(lowered, VERB_GROUPS.resize)) return "resize";

  return "unknown";
}

export function isInvalidInput(command: string): boolean {
  const lowered = command.toLowerCase().trim();
  if (lowered.length < 3) return true;

  const firstWord = lowered.split(" ")[0] ?? "";
  if (firstWord.length > 3 && !/[aeiou]/.test(firstWord)) return true;

  const blocklist = ["fuck", "shit", "ass", "bitch", "damn", "crap", "porn", "sex", "nude", "hack", "exploit", "inject"];
  if (blocklist.some((word) => lowered.includes(word))) return true;

  return false;
}
