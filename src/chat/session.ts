import type { ActionResult, MinesweeperEngine } from "../game/engine";
import type { Difficulty, PublicBoardView } from "../game/types";

const AGENT_DIFFICULTIES = ["beginner", "intermediate", "expert"] as const;
type AgentDifficulty = (typeof AGENT_DIFFICULTIES)[number];

const SESSION_OPTIONS = {
  expectedInputs: [{ type: "text" as const, languages: ["en"] }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
};

const SYSTEM_PROMPT = `You are the in-browser assistant for a Minesweeper game. Every user turn begins with the current board rendered as ASCII, followed by a list of valid hidden-cell coordinates, followed by the user's message.

Reply with a single JSON object that matches the required schema:
- reasoning: one short sentence explaining your choice.
- action.kind: "reveal_cell" | "toggle_flag" | "chord_cell" | "start_new_game" | "chat_only".
- For reveal_cell, toggle_flag, and chord_cell: also include action.row and action.col (zero-indexed integers).
- For start_new_game: also include action.difficulty ("beginner" | "intermediate" | "expert").
- Use "chat_only" when the user just wants to talk without changing the board.

Rules:
- Row indexes count top-down, column indexes left-to-right, all zero-based.
- reveal_cell MUST target a hidden cell (glyph "." in the board). Never target a cell that is already revealed ("_", "1"-"8", "*") or flagged ("F"). If in doubt, cross-check against the "Hidden cells" list.
- toggle_flag MUST target a hidden (".") or flagged ("F") cell — never a revealed one.
- chord_cell MUST target a revealed number cell ("1"-"8") where the number of adjacent flags already equals that number.
- Only reveal cells you are confident are safe. Flag cells you suspect hide a mine.
- If no safe move is certain, prefer "chat_only" and explain your reasoning instead of guessing.
- Board legend: "." hidden, "F" flagged, "_" revealed empty, "1"-"8" adjacent-mine count, "*" revealed mine.`;

export const AGENT_RESPONSE_SCHEMA = {
  type: "object",
  required: ["reasoning", "action"],
  additionalProperties: false,
  properties: {
    reasoning: { type: "string" },
    action: {
      type: "object",
      required: ["kind"],
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          enum: [
            "reveal_cell",
            "toggle_flag",
            "chord_cell",
            "start_new_game",
            "chat_only",
          ],
        },
        row: { type: "integer", minimum: 0 },
        col: { type: "integer", minimum: 0 },
        difficulty: { type: "string", enum: [...AGENT_DIFFICULTIES] },
      },
    },
  },
} as const;

export type AgentAction =
  | { kind: "reveal_cell"; row: number; col: number }
  | { kind: "toggle_flag"; row: number; col: number }
  | { kind: "chord_cell"; row: number; col: number }
  | { kind: "start_new_game"; difficulty: AgentDifficulty }
  | { kind: "chat_only" };

export interface AgentResponse {
  reasoning: string;
  action: AgentAction;
}

export function formatBoardAsText(view: PublicBoardView): string {
  const elapsed = `${Math.floor(view.elapsedMs / 1000)}s`;
  const header =
    `status=${view.status} size=${view.rows}x${view.cols} mines=${view.mines} ` +
    `flags=${view.flagsPlaced} remaining=${view.minesRemaining} ` +
    `revealed=${view.cellsRevealed} elapsed=${elapsed}`;

  const colWidth = String(view.cols - 1).length;
  const rowWidth = String(view.rows - 1).length;
  const pad = (s: string, n: number) => s.padStart(n, " ");
  const blank = pad("", rowWidth);

  const colHeader =
    blank + " |" +
    Array.from({ length: view.cols }, (_, c) => " " + pad(String(c), colWidth)).join("");

  const rows: string[] = [];
  for (let r = 0; r < view.rows; r++) {
    const cells = view.cells[r]
      .map((cell) => {
        switch (cell.state) {
          case "hidden":
            return ".";
          case "flagged":
            return "F";
          case "revealed-empty":
            return "_";
          case "revealed-mine":
            return "*";
          case "revealed-number":
            return String(cell.adjacentMines ?? "?");
        }
      })
      .map((glyph) => " " + pad(glyph, colWidth))
      .join("");
    rows.push(pad(String(r), rowWidth) + " |" + cells);
  }

  return [
    header,
    "Legend: . hidden, F flagged, _ safe empty, 1-8 number of adjacent mines, * mine.",
    colHeader,
    ...rows,
  ].join("\n");
}

const MAX_HIDDEN_CELL_LIST = 120;

function describeHiddenCells(view: PublicBoardView): string {
  const hidden: string[] = [];
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) {
      if (view.cells[r][c].state === "hidden") {
        hidden.push(`(${r},${c})`);
      }
    }
  }
  const total = view.rows * view.cols;
  if (hidden.length === 0) {
    return "Hidden cells: none remain.";
  }
  if (hidden.length === total) {
    return `Hidden cells: all ${total} cells are hidden (no reveals yet) — any coordinate in range is valid.`;
  }
  if (hidden.length > MAX_HIDDEN_CELL_LIST) {
    return `Hidden cells: ${hidden.length} of ${total} cells are hidden. Read the ASCII board and only target coordinates whose glyph is "." (or "F" for toggle_flag).`;
  }
  return `Hidden cells (valid reveal targets): ${hidden.join(", ")}`;
}

export function composeUserMessage(engine: MinesweeperEngine, text: string): string {
  const view = engine.getPublicView();
  const board = formatBoardAsText(view);
  const hiddenSection = describeHiddenCells(view);
  return `Current board:\n${board}\n\n${hiddenSection}\n\nUser: ${text}`;
}

export type AgentActionValidation = { ok: true } | { ok: false; reason: string };

export function validateAgentAction(
  engine: MinesweeperEngine,
  action: AgentAction,
): AgentActionValidation {
  if (action.kind === "chat_only" || action.kind === "start_new_game") {
    return { ok: true };
  }
  const view = engine.getPublicView();
  const { row, col } = action;
  if (row < 0 || row >= view.rows || col < 0 || col >= view.cols) {
    return {
      ok: false,
      reason: `(${row}, ${col}) is out of bounds (board is ${view.rows}×${view.cols}).`,
    };
  }
  const cell = view.cells[row][col];
  switch (action.kind) {
    case "reveal_cell":
      if (cell.state !== "hidden") {
        return {
          ok: false,
          reason: `(${row}, ${col}) is already ${cell.state} — reveal_cell only works on hidden cells (glyph ".").`,
        };
      }
      return { ok: true };
    case "toggle_flag":
      if (cell.state !== "hidden" && cell.state !== "flagged") {
        return {
          ok: false,
          reason: `(${row}, ${col}) is ${cell.state} — toggle_flag only works on hidden or flagged cells.`,
        };
      }
      return { ok: true };
    case "chord_cell":
      if (cell.state !== "revealed-number") {
        return {
          ok: false,
          reason: `(${row}, ${col}) is ${cell.state} — chord_cell only works on revealed number cells (glyph "1"-"8").`,
        };
      }
      return { ok: true };
  }
}

export function parseAgentResponse(raw: string): AgentResponse {
  const data = JSON.parse(raw.trim()) as unknown;
  if (!data || typeof data !== "object") {
    throw new Error("response is not an object");
  }
  const obj = data as Record<string, unknown>;
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
  const actionRaw = obj.action;
  if (!actionRaw || typeof actionRaw !== "object") {
    throw new Error("response is missing an action");
  }
  const a = actionRaw as Record<string, unknown>;
  if (typeof a.kind !== "string") {
    throw new Error("action.kind must be a string");
  }
  switch (a.kind) {
    case "reveal_cell":
    case "toggle_flag":
    case "chord_cell": {
      const row = Number(a.row);
      const col = Number(a.col);
      if (!Number.isInteger(row) || !Number.isInteger(col)) {
        throw new Error(`${a.kind} requires integer row and col`);
      }
      return { reasoning, action: { kind: a.kind, row, col } };
    }
    case "start_new_game": {
      const difficulty =
        typeof a.difficulty === "string" &&
        (AGENT_DIFFICULTIES as readonly string[]).includes(a.difficulty)
          ? (a.difficulty as AgentDifficulty)
          : "beginner";
      return { reasoning, action: { kind: "start_new_game", difficulty } };
    }
    case "chat_only":
      return { reasoning, action: { kind: "chat_only" } };
    default:
      throw new Error(`unknown action kind: ${a.kind}`);
  }
}

export function describeAgentAction(action: AgentAction): string {
  switch (action.kind) {
    case "reveal_cell":
      return `Reveal cell (${action.row}, ${action.col})`;
    case "toggle_flag":
      return `Toggle flag at (${action.row}, ${action.col})`;
    case "chord_cell":
      return `Chord cell (${action.row}, ${action.col})`;
    case "start_new_game":
      return `Start new ${action.difficulty} game`;
    case "chat_only":
      return "Chat only";
  }
}

export function dispatchAgentAction(
  engine: MinesweeperEngine,
  action: AgentAction,
): ActionResult | null {
  switch (action.kind) {
    case "reveal_cell":
      return engine.reveal(action.row, action.col, "agent");
    case "toggle_flag":
      return engine.toggleFlag(action.row, action.col, "agent");
    case "chord_cell":
      return engine.chord(action.row, action.col, "agent");
    case "start_new_game":
      return engine.newGame({ difficulty: action.difficulty as Difficulty }, "agent");
    case "chat_only":
      return null;
  }
}

export type ChatAvailability = "unsupported" | Availability;

export function hasLanguageModel(): boolean {
  return typeof globalThis !== "undefined" && "LanguageModel" in globalThis;
}

export async function probeAvailability(): Promise<ChatAvailability> {
  if (!hasLanguageModel()) return "unsupported";
  try {
    return await LanguageModel.availability(SESSION_OPTIONS);
  } catch {
    return "unavailable";
  }
}

export interface CreateChatSessionOptions {
  onDownloadProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export async function createChatSession(
  options: CreateChatSessionOptions,
): Promise<LanguageModel> {
  if (!hasLanguageModel()) {
    throw new Error("LanguageModel is not available in this browser.");
  }

  return LanguageModel.create({
    ...SESSION_OPTIONS,
    initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
    signal: options.signal,
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        options.onDownloadProgress?.(event.loaded);
      });
    },
  });
}
