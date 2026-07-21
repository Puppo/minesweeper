import { findBestGuess, findDeterministicMove } from "./solver";
import type { GameStatus, PublicBoardView } from "./types";

export interface GameRulesGuide {
  objective: string;
  coordinates: string;
  firstReveal: string;
  cellStates: Record<string, string>;
  actions: Array<{
    tool: "start_new_game" | "reveal_cell" | "toggle_flag" | "chord_cell";
    instruction: string;
  }>;
  winning: string;
  losing: string;
  difficultyPresets: Record<string, string>;
}

export interface PlayStrategyGuide {
  decisionLoop: string[];
  deductionRules: {
    forcedMine: string;
    forcedSafe: string;
    subset: string;
  };
  chordSafety: string;
  guessing: string;
}

export const GAME_RULES: GameRulesGuide = {
  objective:
    "Reveal every non-mine cell without revealing a mine. Flags are optional markers; revealing all safe cells wins the game.",
  coordinates:
    "Coordinates are zero-based: rows increase from top to bottom and columns increase from left to right.",
  firstReveal:
    "The first reveal and all of its in-bounds neighboring cells are guaranteed to be mine-free.",
  cellStates: {
    hidden: "Unknown and eligible to reveal or flag.",
    flagged: "Marked as a suspected mine; toggle the flag off before revealing it.",
    "revealed-empty":
      "A safe cell with no adjacent mines; revealing it cascades through connected empty cells.",
    "revealed-number":
      "A safe cell whose adjacentMines value is the number of mines in its eight-cell neighborhood.",
    "revealed-mine": "A mine exposed after the game is lost.",
  },
  actions: [
    {
      tool: "start_new_game",
      instruction: "Start or reset a board at a preset or custom difficulty.",
    },
    {
      tool: "reveal_cell",
      instruction:
        "Reveal one hidden, unflagged cell. Revealing a mine loses the game.",
    },
    {
      tool: "toggle_flag",
      instruction:
        "Add or remove a flag on an unrevealed cell to mark a proven or suspected mine.",
    },
    {
      tool: "chord_cell",
      instruction:
        "On a revealed number with exactly that many adjacent flags, reveal every other hidden neighbor. Incorrect flags can detonate a mine.",
    },
  ],
  winning: "The game is won when every non-mine cell has been revealed.",
  losing: "The game is lost when a mine is revealed directly or by an unsafe chord.",
  difficultyPresets: {
    beginner: "9 rows × 9 columns, 10 mines",
    intermediate: "16 rows × 16 columns, 40 mines",
    expert: "16 rows × 30 columns, 99 mines",
    custom: "5-30 rows, 5-40 columns, with a valid custom mine count",
  },
};

export const PLAY_STRATEGY: PlayStrategyGuide = {
  decisionLoop: [
    "Read the current board with get_board_state or request a recommendation with analyze_board.",
    "On an untouched board, reveal a central cell to use the guaranteed safe first reveal.",
    "For each revealed number, subtract adjacent flags from its value and inspect its remaining hidden neighbors.",
    "Flag a hidden cell when deduction proves it is a mine.",
    "Reveal or safely chord when deduction proves neighboring cells are safe.",
    "After every action, read or analyze the updated board again; never rely on a stale snapshot.",
    "If no certain move exists, choose the hidden cell with the lowest estimated mine probability.",
  ],
  deductionRules: {
    forcedMine:
      "If a number still needs exactly as many mines as it has hidden neighbors, every one of those hidden neighbors is a mine.",
    forcedSafe:
      "If a number already has as many adjacent flags as its value, every other hidden neighbor is safe.",
    subset:
      "When one numbered cell's hidden-neighbor set is a strict subset of another's, subtract the smaller constraint from the larger to identify safe cells or mines in the difference.",
  },
  chordSafety:
    "Chord only when the adjacent flag count equals the revealed number and the flags are supported by deduction; matching the count with incorrect flags can lose the game.",
  guessing:
    "When guessing is unavoidable, reveal the lowest-probability hidden cell and treat the recommendation as probabilistic, not guaranteed safe.",
};

export interface BoardRecommendation {
  tool: "reveal_cell" | "toggle_flag" | "chord_cell";
  input: { row: number; col: number };
  certainty: "certain-safe" | "certain-mine" | "probabilistic";
  reasoning: string;
  mineProbability?: number;
}

export interface BoardAnalysis {
  status: GameStatus;
  summary: string;
  recommendation: BoardRecommendation | null;
}

export function formatMinesweeperGuideForPrompt(): string {
  return [
    "Minesweeper rules and strategy:",
    `- Objective: ${GAME_RULES.objective}`,
    `- Coordinates: ${GAME_RULES.coordinates}`,
    `- First reveal: ${GAME_RULES.firstReveal}`,
    `- Numbers: ${GAME_RULES.cellStates["revealed-number"]}`,
    `- Forced mine rule: ${PLAY_STRATEGY.deductionRules.forcedMine}`,
    `- Forced safe rule: ${PLAY_STRATEGY.deductionRules.forcedSafe}`,
    `- Subset rule: ${PLAY_STRATEGY.deductionRules.subset}`,
    `- Chording: ${PLAY_STRATEGY.chordSafety}`,
    `- Guessing: ${PLAY_STRATEGY.guessing}`,
    "- Board legend: . hidden, F flagged, _ revealed empty, 1-8 adjacent-mine count, * revealed mine.",
    "- Treat the current board snapshot as the only source of truth.",
  ].join("\n");
}

export function analyzeBoard(view: PublicBoardView): BoardAnalysis {
  if (view.status === "won") {
    return {
      status: view.status,
      summary: "The game is already won; no further move is needed.",
      recommendation: null,
    };
  }
  if (view.status === "lost") {
    return {
      status: view.status,
      summary: "The game is lost; start a new game before requesting another move.",
      recommendation: null,
    };
  }

  const certainMove = findDeterministicMove(view);
  if (certainMove) {
    const tool =
      certainMove.kind === "flag"
        ? "toggle_flag"
        : certainMove.kind === "chord"
          ? "chord_cell"
          : "reveal_cell";
    return {
      status: view.status,
      summary: "A deduction-backed move is available.",
      recommendation: {
        tool,
        input: { row: certainMove.row, col: certainMove.col },
        certainty:
          certainMove.kind === "flag" ? "certain-mine" : "certain-safe",
        reasoning: certainMove.reason,
      },
    };
  }

  const guess = findBestGuess(view);
  if (!guess) {
    return {
      status: view.status,
      summary: "No hidden cell remains and no move is available.",
      recommendation: null,
    };
  }

  return {
    status: view.status,
    summary: "No certain move was found; this is the lowest-risk available guess.",
    recommendation: {
      tool: "reveal_cell",
      input: { row: guess.row, col: guess.col },
      certainty: "probabilistic",
      reasoning: guess.reason,
      mineProbability: guess.mineProbability,
    },
  };
}
