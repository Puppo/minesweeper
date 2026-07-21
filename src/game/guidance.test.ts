import { describe, expect, it } from "vitest";
import {
  analyzeBoard,
  formatMinesweeperGuideForPrompt,
  GAME_RULES,
  PLAY_STRATEGY,
} from "./guidance";
import type { GameStatus, PublicBoardView, PublicCellView } from "./types";

function makeView(
  status: GameStatus = "playing",
  rows = 3,
  cols = 3,
  mines = 1,
): PublicBoardView {
  const cells: PublicCellView[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => ({
      row,
      col,
      state: "hidden" as const,
    })),
  );
  return {
    rows,
    cols,
    mines,
    difficulty: "custom",
    status,
    flagsPlaced: 0,
    minesRemaining: mines,
    cellsRevealed: 0,
    elapsedMs: 0,
    cells,
    cursor: { row: 0, col: 0 },
  };
}

describe("canonical Minesweeper guidance", () => {
  it("covers the rules and strategy agents need to play", () => {
    expect(GAME_RULES.objective).toMatch(/reveal every non-mine/i);
    expect(GAME_RULES.coordinates).toMatch(/zero-based/i);
    expect(GAME_RULES.firstReveal).toMatch(/guaranteed.*mine-free/i);
    expect(GAME_RULES.actions.map((action) => action.tool)).toEqual([
      "start_new_game",
      "reveal_cell",
      "toggle_flag",
      "chord_cell",
    ]);
    expect(GAME_RULES.winning).toMatch(/every non-mine cell/i);
    expect(PLAY_STRATEGY.deductionRules.forcedMine).toMatch(/every.*mine/i);
    expect(PLAY_STRATEGY.deductionRules.forcedSafe).toMatch(/every.*safe/i);
    expect(PLAY_STRATEGY.chordSafety).toMatch(/incorrect flags|lose/i);
    expect(PLAY_STRATEGY.guessing).toMatch(/lowest-probability/i);
  });

  it("formats the same canonical content for the built-in assistant", () => {
    const prompt = formatMinesweeperGuideForPrompt();
    expect(prompt).toContain(GAME_RULES.objective);
    expect(prompt).toContain(PLAY_STRATEGY.deductionRules.forcedMine);
    expect(prompt).toContain(PLAY_STRATEGY.guessing);
  });
});

describe("analyzeBoard", () => {
  it("recommends the guaranteed-safe center opening without mutation", () => {
    const view = makeView("idle", 9, 9, 10);
    const before = structuredClone(view);

    expect(analyzeBoard(view).recommendation).toMatchObject({
      tool: "reveal_cell",
      input: { row: 4, col: 4 },
      certainty: "certain-safe",
    });
    expect(view).toEqual(before);
  });

  it("maps a proven mine to toggle_flag", () => {
    const view = makeView("playing", 3, 3, 8);
    view.cellsRevealed = 1;
    view.cells[1][1] = {
      row: 1,
      col: 1,
      state: "revealed-number",
      adjacentMines: 8,
    };

    expect(analyzeBoard(view).recommendation).toMatchObject({
      tool: "toggle_flag",
      certainty: "certain-mine",
    });
  });

  it("maps a satisfied numbered constraint to chord_cell", () => {
    const view = makeView("playing", 3, 3, 2);
    view.cellsRevealed = 1;
    view.flagsPlaced = 1;
    view.minesRemaining = 1;
    view.cells[1][1] = {
      row: 1,
      col: 1,
      state: "revealed-number",
      adjacentMines: 1,
    };
    view.cells[0][0] = { row: 0, col: 0, state: "flagged" };

    expect(analyzeBoard(view).recommendation).toMatchObject({
      tool: "chord_cell",
      input: { row: 1, col: 1 },
      certainty: "certain-safe",
    });
  });

  it("labels the lowest-risk fallback as probabilistic", () => {
    const view = makeView("playing", 3, 3, 1);
    view.cellsRevealed = 1;
    view.cells[1][1] = { row: 1, col: 1, state: "revealed-empty" };

    const recommendation = analyzeBoard(view).recommendation;
    expect(recommendation).toMatchObject({
      tool: "reveal_cell",
      certainty: "probabilistic",
    });
    expect(recommendation?.mineProbability).toBeCloseTo(1 / 8);
  });

  it.each(["won", "lost"] as const)(
    "returns no recommendation after a %s game",
    (status) => {
      expect(analyzeBoard(makeView(status)).recommendation).toBeNull();
    },
  );
});
