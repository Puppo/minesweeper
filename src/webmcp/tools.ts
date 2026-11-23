import { z } from "zod";
import type { MinesweeperEngine } from "../game/engine";
import {
  analyzeBoard,
  GAME_RULES,
  PLAY_STRATEGY,
} from "../game/guidance";

const StartNewGameInput = z.object({
  difficulty: z
    .enum(["beginner", "intermediate", "expert", "custom"])
    .describe("Preset difficulty or 'custom' to use rows/cols/mines."),
  rows: z
    .int()
    .min(5)
    .max(30)
    .optional()
    .describe("Only used when difficulty is 'custom'."),
  cols: z
    .int()
    .min(5)
    .max(40)
    .optional()
    .describe("Only used when difficulty is 'custom'."),
  mines: z
    .int()
    .min(1)
    .optional()
    .describe("Only used when difficulty is 'custom'."),
});

const RevealCellInput = z.object({
  row: z.int().min(0).describe("Zero-indexed row."),
  col: z.int().min(0).describe("Zero-indexed column."),
});

const RowColInput = z.object({
  row: z.int().min(0),
  col: z.int().min(0),
});

const EmptyInput = z.object({}).strict();

interface ToolSpec<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  annotations?: WebMCP.ToolAnnotations;
  execute(input: z.infer<S>): Promise<unknown> | unknown;
}

function defineTool<S extends z.ZodType>(spec: ToolSpec<S>): WebMCP.ModelContextTool {
  return {
    name: spec.name,
    description: spec.description,
    annotations: spec.annotations,
    inputSchema: z.toJSONSchema(spec.schema),
    execute: (input) => spec.execute(input as z.infer<S>),
  };
}

/**
 * Canonical Minesweeper tool definitions shaped for WebMCP
 * (`document.modelContext.registerTool`). The same definitions are bridged
 * into `LanguageModel.create({ tools })` via `mcpToolsAsLanguageModelTools`.
 */
export function minesweeperTools(engine: MinesweeperEngine): WebMCP.ModelContextTool[] {
  return [
    defineTool({
      name: "get_game_rules",
      description:
        "Learn the complete Minesweeper rules, coordinate system, cell states, actions, difficulty presets, and win/loss conditions before playing.",
      annotations: { readOnlyHint: true },
      schema: EmptyInput,
      execute() {
        return GAME_RULES;
      },
    }),
    defineTool({
      name: "get_play_strategy",
      description:
        "Learn an ordered Minesweeper strategy for finding forced mines, finding safe cells, chording safely, and minimizing risk when a guess is unavoidable.",
      annotations: { readOnlyHint: true },
      schema: EmptyInput,
      execute() {
        return PLAY_STRATEGY;
      },
    }),
    defineTool({
      name: "analyze_board",
      description:
        "Analyze the current public board without changing it. Returns one deduction-backed next action when possible, otherwise the lowest-risk probabilistic reveal, using an existing action tool name and input.",
      annotations: { readOnlyHint: true },
      schema: EmptyInput,
      execute() {
        return analyzeBoard(engine.getPublicView());
      },
    }),
    defineTool({
      name: "start_new_game",
      description:
        "Start a new Minesweeper game. Use 'beginner' (9x9, 10 mines), 'intermediate' (16x16, 40 mines), 'expert' (16x30, 99 mines), or 'custom' to supply rows, cols, and mines.",
      schema: StartNewGameInput,
      execute(input) {
        const result = engine.newGame(input, "agent");
        return {
          ok: result.ok,
          status: result.status,
          message: result.message,
          board: engine.getPublicView(),
        };
      },
    }),
    defineTool({
      name: "reveal_cell",
      description:
        "Reveal the cell at (row, col). Rows and cols are zero-indexed. Reveals cascade for empty cells. Revealing a mine ends the game. Returns the updated board and status.",
      schema: RevealCellInput,
      execute({ row, col }) {
        const result = engine.reveal(row, col, "agent");
        return {
          ok: result.ok,
          status: result.status,
          message: result.message,
          board: engine.getPublicView(),
        };
      },
    }),
    defineTool({
      name: "toggle_flag",
      description:
        "Toggle a flag on the hidden cell at (row, col). Flags mark suspected mines and prevent accidental reveal. Ignored on already-revealed cells.",
      schema: RowColInput,
      execute({ row, col }) {
        const result = engine.toggleFlag(row, col, "agent");
        return {
          ok: result.ok,
          status: result.status,
          message: result.message,
          board: engine.getPublicView(),
        };
      },
    }),
    defineTool({
      name: "chord_cell",
      description:
        "Chord on a revealed numbered cell at (row, col): if exactly the cell's number of flags is placed on its neighbors, reveal all other neighbors at once. Fails (and warns) if flag count doesn't match. If any flag is wrong, you'll hit a mine.",
      schema: RowColInput,
      execute({ row, col }) {
        const result = engine.chord(row, col, "agent");
        return {
          ok: result.ok,
          status: result.status,
          message: result.message,
          board: engine.getPublicView(),
        };
      },
    }),
    defineTool({
      name: "get_board_state",
      description:
        "Return the full current board state as the agent sees it: cell states ('hidden', 'flagged', 'revealed-empty', 'revealed-number' with adjacentMines, or 'revealed-mine'), dimensions, mines remaining, elapsed time, and game status.",
      annotations: { readOnlyHint: true },
      schema: EmptyInput,
      execute() {
        return engine.getPublicView();
      },
    }),
    defineTool({
      name: "get_game_status",
      description:
        "Return a compact summary: status ('idle', 'playing', 'won', 'lost'), rows, cols, mines, minesRemaining, cellsRevealed, elapsedMs.",
      annotations: { readOnlyHint: true },
      schema: EmptyInput,
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
    }),
  ];
}
