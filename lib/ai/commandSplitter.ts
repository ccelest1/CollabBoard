export type CommandStep = { raw: string; index: number; total: number };

const STEP_DELIMITER_REGEX =
  /\s+and then\s+|\s+then\s+|,\s*then\s+|\s+after that\s+|\s+next\s+|\s+finally\s+|,\s*and\s+/i;

export function splitIntoSteps(command: string): string[] {
  if (!STEP_DELIMITER_REGEX.test(command)) {
    return [command];
  }

  return command
    .split(STEP_DELIMITER_REGEX)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}
