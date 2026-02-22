import { describe, it, expect } from "vitest";
import { classifyIntent, isInvalidInput } from "@/lib/ai/intentClassifier";

describe("Intent classification", () => {
  it.each([
    "delete the SWOT analysis",
    "remove all sticky notes",
    "erase the board",
    "clear the board",
    "get rid of those sticky notes",
    "delete those sticky notes",
    "delete the user journey map",
    "remove all yellow sticky notes",
    "delete everything",
    "wipe the board",
  ])('classifies "%s" as delete', (cmd) => {
    expect(classifyIntent(cmd)).toBe("delete");
  });

  it.each([
    "delete the SWOT analysis",
    "remove the retrospective",
    "erase the journey map",
  ])('"%s" is NOT swot/retro/journey', (cmd) => {
    const intent = classifyIntent(cmd);
    expect(intent).toBe("delete");
    expect(intent).not.toBe("swot");
    expect(intent).not.toBe("retrospective");
    expect(intent).not.toBe("journey_map");
  });

  it.each([
    "create a SWOT analysis",
    "build a SWOT analysis with four quadrants",
    "make a SWOT board",
    "set up a strengths and weaknesses analysis",
    "generate a SWOT template",
  ])('classifies "%s" as swot', (cmd) => {
    expect(classifyIntent(cmd)).toBe("swot");
  });

  it.each([
    "create 5 sticky notes",
    "add three rectangles",
    "generate seven green rectangles in a row",
    "make 10 frames",
    "give me 4 blue circles",
  ])('classifies "%s" as create_bulk', (cmd) => {
    expect(classifyIntent(cmd)).toBe("create_bulk");
  });

  it.each([
    "build a user journey map with 5 stages",
    "create a customer journey map",
    "set up a journey map",
    "make a user journey with 5 stages",
  ])('classifies "%s" as journey_map', (cmd) => {
    expect(classifyIntent(cmd)).toBe("journey_map");
  });

  it.each(["xkqz", "hi", "yo", "", "   "])('classifies "%s" as invalid', (cmd) => {
    expect(isInvalidInput(cmd)).toBe(true);
  });

  it.each([
    "create a sticky note",
    "What Didn't Go Well",
    "move all pink sticky notes to the right",
  ])('"%s" is not invalid', (cmd) => {
    expect(isInvalidInput(cmd)).toBe(false);
  });
});
