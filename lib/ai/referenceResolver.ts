import type { BoardObject } from "@/lib/boards/model";

import { SessionMemory } from "./sessionMemory";

const REFERENCE_WORDS = [
  "those",
  "them",
  "these",
  "the ones",
  "just made",
  "i just created",
  "the new ones",
];

export function resolveReferences(params: {
  stepCommand: string;
  sessionMemory: SessionMemory;
  boardObjects: BoardObject[];
}): { resolvedIds: string[]; isReferenceToCreated: boolean } {
  const { stepCommand, sessionMemory } = params;
  const lowerCommand = stepCommand.toLowerCase();

  const hasReferenceWord = REFERENCE_WORDS.some((word) =>
    lowerCommand.includes(word)
  );

  if (hasReferenceWord && sessionMemory.hasCreatedObjects()) {
    return {
      resolvedIds: sessionMemory.getCreatedIds(),
      isReferenceToCreated: true,
    };
  }

  const lastNMatch = lowerCommand.match(/\blast\s+(\d+)\b/);
  if (lastNMatch) {
    const count = Number(lastNMatch[1]);
    return {
      resolvedIds: sessionMemory.getLastCreatedIds(count),
      isReferenceToCreated: true,
    };
  }

  return { resolvedIds: [], isReferenceToCreated: false };
}

export function injectResolvedIds(stepCommand: string, ids: string[]): string {
  if (ids.length === 0) {
    return stepCommand;
  }

  return `${stepCommand} [targeting object IDs: ${ids.join(",")}]`;
}
