import type { MinesweeperEngine } from "../game/engine";
import type { Difficulty } from "../game/types";

export interface WebMcpHandle {
  available: boolean;
  dispose(): void;
  toolNames: string[];
}

const DIFFICULTY_VALUES: Difficulty[] = ["beginner", "intermediate", "expert", "custom"];

function coerceInt(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return parseInt(value, 10);
  throw new Error(`${field} must be an integer (got ${JSON.stringify(value)}).`);
}

function coerceDifficulty(value: unknown): Difficulty {
  if (typeof value !== "string") {
    throw new Error(
      `difficulty must be one of ${DIFFICULTY_VALUES.join(", ")} (got ${JSON.stringify(value)}).`,
    );
  }
  if (!DIFFICULTY_VALUES.includes(value as Difficulty)) {
    throw new Error(
      `difficulty must be one of ${DIFFICULTY_VALUES.join(", ")} (got "${value}").`,
    );
  }
  return value as Difficulty;
}

export function registerWebMcpTools(engine: MinesweeperEngine): WebMcpHandle {
  if (typeof navigator === "undefined" || !navigator.modelContext) {
    return { available: false, dispose() {}, toolNames: [] };
  }

  const modelContext = navigator.modelContext;
  const controller = new AbortController();
  const toolNames: string[] = [];

  const register = (tool: ModelContextTool) => {
    modelContext.registerTool(tool, { signal: controller.signal });
    toolNames.push(tool.name);
  };

  register({
    name: "minesweeper_start_new_game",
    description:
      "Start a new Minesweeper game. Use 'beginner' (9x9, 10 mines), 'intermediate' (16x16, 40 mines), 'expert' (16x30, 99 mines), or 'custom' to supply rows, cols, and mines.",
    inputSchema: {
      type: "object",
      properties: {
        difficulty: {
          type: "string",
          enum: DIFFICULTY_VALUES,
          description: "Preset difficulty or 'custom' to use rows/cols/mines.",
        },
        rows: { type: "integer", minimum: 5, maximum: 30, description: "Only used when difficulty is 'custom'." },
        cols: { type: "integer", minimum: 5, maximum: 40, description: "Only used when difficulty is 'custom'." },
        mines: { type: "integer", minimum: 1, description: "Only used when difficulty is 'custom'." },
      },
      required: ["difficulty"],
      additionalProperties: false,
    },
    execute(input) {
      const difficulty = coerceDifficulty(input.difficulty);
      const payload: {
        difficulty: Difficulty;
        rows?: number;
        cols?: number;
        mines?: number;
      } = { difficulty };
      if (difficulty === "custom") {
        if (input.rows != null) payload.rows = coerceInt(input.rows, "rows");
        if (input.cols != null) payload.cols = coerceInt(input.cols, "cols");
        if (input.mines != null) payload.mines = coerceInt(input.mines, "mines");
      }
      const result = engine.newGame(payload, "agent");
      return {
        ok: result.ok,
        status: result.status,
        message: result.message,
        board: engine.getPublicView(),
      };
    },
  });

  register({
    name: "minesweeper_reveal_cell",
    description:
      "Reveal the cell at (row, col). Rows and cols are zero-indexed. Reveals cascade for empty cells. Revealing a mine ends the game. Returns the updated board and status.",
    inputSchema: {
      type: "object",
      properties: {
        row: { type: "integer", minimum: 0, description: "Zero-indexed row." },
        col: { type: "integer", minimum: 0, description: "Zero-indexed column." },
      },
      required: ["row", "col"],
      additionalProperties: false,
    },
    execute(input) {
      const row = coerceInt(input.row, "row");
      const col = coerceInt(input.col, "col");
      const result = engine.reveal(row, col, "agent");
      return {
        ok: result.ok,
        status: result.status,
        message: result.message,
        board: engine.getPublicView(),
      };
    },
  });

  register({
    name: "minesweeper_toggle_flag",
    description:
      "Toggle a flag on the hidden cell at (row, col). Flags mark suspected mines and prevent accidental reveal. Ignored on already-revealed cells.",
    inputSchema: {
      type: "object",
      properties: {
        row: { type: "integer", minimum: 0 },
        col: { type: "integer", minimum: 0 },
      },
      required: ["row", "col"],
      additionalProperties: false,
    },
    execute(input) {
      const row = coerceInt(input.row, "row");
      const col = coerceInt(input.col, "col");
      const result = engine.toggleFlag(row, col, "agent");
      return {
        ok: result.ok,
        status: result.status,
        message: result.message,
        board: engine.getPublicView(),
      };
    },
  });

  register({
    name: "minesweeper_chord_cell",
    description:
      "Chord on a revealed numbered cell at (row, col): if exactly the cell's number of flags is placed on its neighbors, reveal all other neighbors at once. Fails (and warns) if flag count doesn't match. If any flag is wrong, you'll hit a mine.",
    inputSchema: {
      type: "object",
      properties: {
        row: { type: "integer", minimum: 0 },
        col: { type: "integer", minimum: 0 },
      },
      required: ["row", "col"],
      additionalProperties: false,
    },
    execute(input) {
      const row = coerceInt(input.row, "row");
      const col = coerceInt(input.col, "col");
      const result = engine.chord(row, col, "agent");
      return {
        ok: result.ok,
        status: result.status,
        message: result.message,
        board: engine.getPublicView(),
      };
    },
  });

  register({
    name: "minesweeper_get_board_state",
    description:
      "Return the full current board state as the agent sees it: cell states ('hidden', 'flagged', 'revealed-empty', 'revealed-number' with adjacentMines, or 'revealed-mine'), dimensions, mines remaining, elapsed time, and game status.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute() {
      return engine.getPublicView();
    },
  });

  register({
    name: "minesweeper_get_game_status",
    description:
      "Return a compact summary: status ('idle', 'playing', 'won', 'lost'), rows, cols, mines, minesRemaining, cellsRevealed, elapsedMs.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute() {
      const view = engine.getPublicView();
      return {
        status: view.status,
        rows: view.rows,
        cols: view.cols,
        mines: view.mines,
        minesRemaining: view.minesRemaining,
        cellsRevealed: view.cellsRevealed,
        elapsedMs: view.elapsedMs,
        difficulty: view.difficulty,
      };
    },
  });

  return {
    available: true,
    toolNames,
    dispose() {
      for (const name of [...toolNames].reverse()) {
        try {
          modelContext.unregisterTool?.(name);
        } catch {
          // ignore stale cleanup
        }
      }
      controller.abort();
    },
  };
}
