export type Difficulty = "beginner" | "intermediate" | "expert" | "custom";

export type GameStatus = "idle" | "playing" | "won" | "lost";

export interface CellState {
  row: number;
  col: number;
  isMine: boolean;
  adjacentMines: number;
  revealed: boolean;
  flagged: boolean;
  detonated: boolean;
}

export interface BoardConfig {
  rows: number;
  cols: number;
  mines: number;
  difficulty: Difficulty;
}

export interface GameState {
  config: BoardConfig;
  cells: CellState[][];
  status: GameStatus;
  flagsPlaced: number;
  cellsRevealed: number;
  startedAt: number | null;
  endedAt: number | null;
  cursor: { row: number; col: number };
  lastAction: ActionLog | null;
  seed: number;
}

export interface ActionLog {
  kind:
    | "reveal"
    | "flag"
    | "unflag"
    | "chord"
    | "new-game"
    | "win"
    | "lose"
    | "noop";
  row?: number;
  col?: number;
  source: "human" | "agent";
  timestamp: number;
  message: string;
}

export interface PublicCellView {
  row: number;
  col: number;
  state: "hidden" | "flagged" | "revealed-empty" | "revealed-number" | "revealed-mine";
  adjacentMines?: number;
}

export interface PublicBoardView {
  rows: number;
  cols: number;
  mines: number;
  difficulty: Difficulty;
  status: GameStatus;
  flagsPlaced: number;
  minesRemaining: number;
  cellsRevealed: number;
  elapsedMs: number;
  cells: PublicCellView[][];
  cursor: { row: number; col: number };
}

export const DIFFICULTY_PRESETS: Record<
  Exclude<Difficulty, "custom">,
  Omit<BoardConfig, "difficulty">
> = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
};
