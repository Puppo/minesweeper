import { NEIGHBOR_OFFSETS } from "./geometry";
import {
  ActionLog,
  BoardConfig,
  CellState,
  DIFFICULTY_PRESETS,
  Difficulty,
  GameState,
  PublicBoardView,
  PublicCellView,
} from "./types";

type Listener = (state: GameState) => void;

export interface NewGameInput {
  difficulty: Difficulty;
  rows?: number;
  cols?: number;
  mines?: number;
}

export interface ActionResult {
  ok: boolean;
  status: GameState["status"];
  message: string;
  action: ActionLog;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createEmptyBoard(rows: number, cols: number): CellState[][] {
  const grid: CellState[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: CellState[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        row: r,
        col: c,
        isMine: false,
        adjacentMines: 0,
        revealed: false,
        flagged: false,
        detonated: false,
      });
    }
    grid.push(row);
  }
  return grid;
}

function placeMines(
  grid: CellState[][],
  mineCount: number,
  safeRow: number,
  safeCol: number,
): void {
  const rows = grid.length;
  const cols = grid[0].length;
  const totalCells = rows * cols;

  const safeZone = new Set<number>();
  for (const [dr, dc] of [[0, 0], ...NEIGHBOR_OFFSETS]) {
    const r = safeRow + dr;
    const c = safeCol + dc;
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      safeZone.add(r * cols + c);
    }
  }

  const effectiveMines = Math.min(mineCount, totalCells - safeZone.size);
  const candidates: number[] = [];
  for (let i = 0; i < totalCells; i++) {
    if (!safeZone.has(i)) candidates.push(i);
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  for (let i = 0; i < effectiveMines; i++) {
    const idx = candidates[i];
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    grid[r][c].isMine = true;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c].isMine) continue;
      let count = 0;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = r + dr;
        const nc = c + dc;
        if (
          nr >= 0 &&
          nr < rows &&
          nc >= 0 &&
          nc < cols &&
          grid[nr][nc].isMine
        ) {
          count++;
        }
      }
      grid[r][c].adjacentMines = count;
    }
  }
}

function resolveConfig(input: NewGameInput): BoardConfig {
  if (input.difficulty === "custom") {
    const rows = clamp(Math.floor(input.rows ?? 16), 5, 30);
    const cols = clamp(Math.floor(input.cols ?? 16), 5, 40);
    const maxMines = rows * cols - 9;
    const mines = clamp(
      Math.floor(input.mines ?? Math.round(rows * cols * 0.18)),
      1,
      maxMines,
    );
    return { rows, cols, mines, difficulty: "custom" };
  }
  const preset = DIFFICULTY_PRESETS[input.difficulty];
  return { ...preset, difficulty: input.difficulty };
}

export class MinesweeperEngine {
  private state: GameState;
  private listeners = new Set<Listener>();
  private minesPlaced = false;

  constructor(initial: NewGameInput = { difficulty: "beginner" }) {
    this.state = this.buildFreshState(resolveConfig(initial));
  }

  private buildFreshState(config: BoardConfig): GameState {
    return {
      config,
      cells: createEmptyBoard(config.rows, config.cols),
      status: "idle",
      flagsPlaced: 0,
      cellsRevealed: 0,
      startedAt: null,
      endedAt: null,
      cursor: { row: 0, col: 0 },
      lastAction: null,
      seed: Math.random(),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  getState(): GameState {
    return this.state;
  }

  getPublicView(): PublicBoardView {
    const {
      config,
      cells,
      status,
      flagsPlaced,
      cellsRevealed,
      startedAt,
      endedAt,
      cursor,
    } = this.state;

    const elapsedMs = startedAt ? (endedAt ?? Date.now()) - startedAt : 0;

    const publicCells: PublicCellView[][] = cells.map((row) =>
      row.map((cell): PublicCellView => {
        if (cell.flagged && !cell.revealed) {
          return { row: cell.row, col: cell.col, state: "flagged" };
        }
        if (!cell.revealed) {
          if (status === "lost" && cell.isMine) {
            return { row: cell.row, col: cell.col, state: "revealed-mine" };
          }
          return { row: cell.row, col: cell.col, state: "hidden" };
        }
        if (cell.isMine) {
          return { row: cell.row, col: cell.col, state: "revealed-mine" };
        }
        if (cell.adjacentMines === 0) {
          return { row: cell.row, col: cell.col, state: "revealed-empty" };
        }
        return {
          row: cell.row,
          col: cell.col,
          state: "revealed-number",
          adjacentMines: cell.adjacentMines,
        };
      }),
    );

    return {
      rows: config.rows,
      cols: config.cols,
      mines: config.mines,
      difficulty: config.difficulty,
      status,
      flagsPlaced,
      minesRemaining: Math.max(0, config.mines - flagsPlaced),
      cellsRevealed,
      elapsedMs,
      cells: publicCells,
      cursor,
    };
  }

  newGame(
    input: NewGameInput,
    source: "human" | "agent" | "solver" | "guess" = "human",
  ): ActionResult {
    const config = resolveConfig(input);
    this.state = this.buildFreshState(config);
    this.minesPlaced = false;
    const action: ActionLog = {
      kind: "new-game",
      source,
      timestamp: Date.now(),
      message: `New ${config.difficulty} game (${config.rows}×${config.cols}, ${config.mines} mines).`,
    };
    this.state.lastAction = action;
    this.emit();
    return {
      ok: true,
      status: this.state.status,
      message: action.message,
      action,
    };
  }

  moveCursor(row: number, col: number): void {
    const r = clamp(row, 0, this.state.config.rows - 1);
    const c = clamp(col, 0, this.state.config.cols - 1);
    this.state.cursor = { row: r, col: c };
    this.emit();
  }

  private assertInBounds(row: number, col: number): string | null {
    const { rows, cols } = this.state.config;
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return `row and col must be integers (got row=${row}, col=${col}).`;
    }
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      return `Cell (${row}, ${col}) is out of bounds (board is ${rows}×${cols}).`;
    }
    return null;
  }

  private isTerminal(): boolean {
    return this.state.status === "won" || this.state.status === "lost";
  }

  reveal(
    row: number,
    col: number,
    source: "human" | "agent" | "solver" | "guess" = "human",
  ): ActionResult {
    const invalid = this.assertInBounds(row, col);
    if (invalid) return this.noop(invalid, source, row, col);
    if (this.isTerminal()) {
      return this.noop(
        `Game is already ${this.state.status}. Start a new game to continue.`,
        source,
        row,
        col,
      );
    }

    const cell = this.state.cells[row][col];
    if (cell.revealed) {
      return this.noop(
        `Cell (${row}, ${col}) is already revealed.`,
        source,
        row,
        col,
      );
    }
    if (cell.flagged) {
      return this.noop(
        `Cell (${row}, ${col}) is flagged — unflag it before revealing.`,
        source,
        row,
        col,
      );
    }

    if (!this.minesPlaced) {
      placeMines(this.state.cells, this.state.config.mines, row, col);
      this.minesPlaced = true;
      this.state.status = "playing";
      this.state.startedAt = Date.now();
    }

    if (cell.isMine) {
      cell.revealed = true;
      cell.detonated = true;
      this.revealAllMines();
      this.state.status = "lost";
      this.state.endedAt = Date.now();
      const action: ActionLog = {
        kind: "lose",
        row,
        col,
        source,
        timestamp: Date.now(),
        message: `💥 Boom! Hit a mine at (${row}, ${col}).`,
      };
      this.state.lastAction = action;
      this.emit();
      return { ok: true, status: "lost", message: action.message, action };
    }

    const newlyRevealed = this.floodReveal(row, col);
    this.state.cellsRevealed += newlyRevealed;
    this.maybeFinishWin();
    const action: ActionLog = {
      kind: "reveal",
      row,
      col,
      source,
      timestamp: Date.now(),
      message:
        newlyRevealed === 1
          ? `Revealed (${row}, ${col}): ${cell.adjacentMines === 0 ? "empty" : `${cell.adjacentMines}`}.`
          : `Revealed ${newlyRevealed} cells starting at (${row}, ${col}).`,
    };
    this.state.lastAction = action;
    this.emit();
    return {
      ok: true,
      status: this.state.status,
      message: action.message,
      action,
    };
  }

  toggleFlag(
    row: number,
    col: number,
    source: "human" | "agent" | "solver" | "guess" = "human",
  ): ActionResult {
    const invalid = this.assertInBounds(row, col);
    if (invalid) return this.noop(invalid, source, row, col);
    if (this.isTerminal()) {
      return this.noop(
        `Game is already ${this.state.status}.`,
        source,
        row,
        col,
      );
    }
    const cell = this.state.cells[row][col];
    if (cell.revealed) {
      return this.noop(
        `Cannot flag a revealed cell at (${row}, ${col}).`,
        source,
        row,
        col,
      );
    }
    cell.flagged = !cell.flagged;
    this.state.flagsPlaced += cell.flagged ? 1 : -1;
    const action: ActionLog = {
      kind: cell.flagged ? "flag" : "unflag",
      row,
      col,
      source,
      timestamp: Date.now(),
      message: cell.flagged
        ? `Flagged (${row}, ${col}).`
        : `Removed flag from (${row}, ${col}).`,
    };
    this.state.lastAction = action;
    this.emit();
    return {
      ok: true,
      status: this.state.status,
      message: action.message,
      action,
    };
  }

  chord(
    row: number,
    col: number,
    source: "human" | "agent" | "solver" | "guess" = "human",
  ): ActionResult {
    const invalid = this.assertInBounds(row, col);
    if (invalid) return this.noop(invalid, source, row, col);
    if (this.isTerminal()) {
      return this.noop(
        `Game is already ${this.state.status}.`,
        source,
        row,
        col,
      );
    }
    const cell = this.state.cells[row][col];
    if (!cell.revealed) {
      return this.noop(
        `Cell (${row}, ${col}) must be revealed before chording.`,
        source,
        row,
        col,
      );
    }
    if (cell.adjacentMines === 0) {
      return this.noop(
        `Chording at (${row}, ${col}) is a no-op because it has no adjacent mines.`,
        source,
        row,
        col,
      );
    }
    const { rows, cols } = this.state.config;
    let flagsAround = 0;
    const toReveal: Array<[number, number]> = [];
    for (const [dr, dc] of NEIGHBOR_OFFSETS) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const neighbor = this.state.cells[nr][nc];
      if (neighbor.flagged) flagsAround++;
      else if (!neighbor.revealed) toReveal.push([nr, nc]);
    }
    if (flagsAround !== cell.adjacentMines) {
      return this.noop(
        `Chord refused: ${flagsAround} flags around (${row}, ${col}) but value is ${cell.adjacentMines}.`,
        source,
        row,
        col,
      );
    }

    let detonated = false;
    let revealedCount = 0;
    for (const [nr, nc] of toReveal) {
      const target = this.state.cells[nr][nc];
      if (target.isMine) {
        target.revealed = true;
        target.detonated = true;
        detonated = true;
      } else if (!target.revealed) {
        revealedCount += this.floodReveal(nr, nc);
      }
    }

    if (detonated) {
      this.revealAllMines();
      this.state.status = "lost";
      this.state.endedAt = Date.now();
      const action: ActionLog = {
        kind: "lose",
        row,
        col,
        source,
        timestamp: Date.now(),
        message: `💥 Chord at (${row}, ${col}) hit a mine. Flag placement was wrong.`,
      };
      this.state.lastAction = action;
      this.emit();
      return { ok: true, status: "lost", message: action.message, action };
    }

    this.state.cellsRevealed += revealedCount;
    this.maybeFinishWin();
    const action: ActionLog = {
      kind: "chord",
      row,
      col,
      source,
      timestamp: Date.now(),
      message: `Chorded (${row}, ${col}) and revealed ${revealedCount} cell${revealedCount === 1 ? "" : "s"}.`,
    };
    this.state.lastAction = action;
    this.emit();
    return {
      ok: true,
      status: this.state.status,
      message: action.message,
      action,
    };
  }

  private floodReveal(startRow: number, startCol: number): number {
    const { rows, cols } = this.state.config;
    const stack: Array<[number, number]> = [[startRow, startCol]];
    let count = 0;
    while (stack.length) {
      const [r, c] = stack.pop()!;
      const cell = this.state.cells[r][c];
      if (cell.revealed || cell.flagged || cell.isMine) continue;
      cell.revealed = true;
      count++;
      if (cell.adjacentMines === 0) {
        for (const [dr, dc] of NEIGHBOR_OFFSETS) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const neighbor = this.state.cells[nr][nc];
            if (!neighbor.revealed && !neighbor.flagged && !neighbor.isMine) {
              stack.push([nr, nc]);
            }
          }
        }
      }
    }
    return count;
  }

  private revealAllMines(): void {
    for (const row of this.state.cells) {
      for (const cell of row) {
        if (cell.isMine) cell.revealed = true;
      }
    }
  }

  private maybeFinishWin(): void {
    const { rows, cols, mines } = this.state.config;
    const safeCells = rows * cols - mines;
    if (
      this.state.cellsRevealed >= safeCells &&
      this.state.status === "playing"
    ) {
      this.state.status = "won";
      this.state.endedAt = Date.now();
      for (const row of this.state.cells) {
        for (const cell of row) {
          if (cell.isMine && !cell.flagged) {
            cell.flagged = true;
            this.state.flagsPlaced++;
          }
        }
      }
      this.state.lastAction = {
        kind: "win",
        source: this.state.lastAction?.source ?? "human",
        timestamp: Date.now(),
        message: "🎉 All safe cells revealed — you win!",
      };
    }
  }

  private noop(
    message: string,
    source: "human" | "agent" | "solver" | "guess",
    row?: number,
    col?: number,
  ): ActionResult {
    const action: ActionLog = {
      kind: "noop",
      row,
      col,
      source,
      timestamp: Date.now(),
      message,
    };
    this.state.lastAction = action;
    this.emit();
    return { ok: false, status: this.state.status, message, action };
  }
}
