export type TemplateObjectExpectation = {
  type: "frame" | "sticky" | "connector";
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TemplateExpectation = {
  name: string;
  objects: TemplateObjectExpectation[];
};

export const GRID_GAP = 20;

export function gridPosition(col: number, row: number, itemWidth: number, itemHeight: number) {
  return {
    x: col * (itemWidth + GRID_GAP),
    y: row * (itemHeight + GRID_GAP),
  };
}

export const SWOT_TEMPLATE: TemplateExpectation = {
  name: "SWOT",
  objects: [
    { type: "frame", text: "Strengths", x: 0, y: 0, width: 200, height: 200 },
    { type: "frame", text: "Weaknesses", x: 220, y: 0, width: 200, height: 200 },
    { type: "frame", text: "Opportunities", x: 0, y: 220, width: 200, height: 200 },
    { type: "frame", text: "Threats", x: 220, y: 220, width: 200, height: 200 },
  ],
};

export const RETROSPECTIVE_TEMPLATE: TemplateExpectation = {
  name: "Retrospective Board",
  objects: [
    { type: "frame", text: "What Went Well", x: 0, y: 0, width: 200, height: 400 },
    { type: "frame", text: "What Didn't", x: 220, y: 0, width: 200, height: 400 },
    { type: "frame", text: "Action Items", x: 440, y: 0, width: 200, height: 400 },
  ],
};

export const USER_JOURNEY_MAP_TEMPLATE: TemplateExpectation = {
  name: "User Journey Map",
  objects: [
    { type: "sticky", text: "Stage 1", x: 0, y: 0, width: 150, height: 150 },
    { type: "sticky", text: "Stage 2", x: 170, y: 0, width: 150, height: 150 },
    { type: "sticky", text: "Stage 3", x: 340, y: 0, width: 150, height: 150 },
    { type: "sticky", text: "Stage 4", x: 510, y: 0, width: 150, height: 150 },
    { type: "sticky", text: "Stage 5", x: 680, y: 0, width: 150, height: 150 },
    { type: "connector", x: 75, y: 75, width: 170, height: 1 },
    { type: "connector", x: 245, y: 75, width: 170, height: 1 },
    { type: "connector", x: 415, y: 75, width: 170, height: 1 },
    { type: "connector", x: 585, y: 75, width: 170, height: 1 },
  ],
};
