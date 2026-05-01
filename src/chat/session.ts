import type { ActionResult, MinesweeperEngine } from "../game/engine";
import {
  buildConstraints,
  estimateMineProbabilities,
  formatConstraintDigest,
} from "../game/solver";
import type { Difficulty, PublicBoardView } from "../game/types";

const AGENT_DIFFICULTIES = ["beginner", "intermediate", "expert"] as const;
type AgentDifficulty = (typeof AGENT_DIFFICULTIES)[number];

export type ChatMode = "help" | "auto" | "chat";

export const MODE_HINTS: Record<ChatMode, string> = {
  help: "",
  auto:
    "You are playing autonomously. Choose the single best next action. " +
    "When no move is provably safe from constraint analysis, reveal the cell with the " +
    "lowest mine probability from the 'Mine probability estimates' section. " +
    "Never use chat_only to avoid making a move — always act.",
  chat: "Conversation mode: discuss the board only. Do not modify the board — use chat_only.",
};

const SESSION_OPTIONS = {
  expectedInputs: [{ type: "text" as const, languages: ["en"] }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
};

const SYSTEM_PROMPT = `You are the in-browser assistant for a Minesweeper game. Every user turn begins with the current board rendered as ASCII, the constraint digest, and a list of valid hidden-cell coordinates, followed by the user's message.

Reply with a single JSON object that matches the per-turn schema:
- reasoning: one short sentence explaining your choice.
- action.kind: "reveal_cell" | "toggle_flag" | "chord_cell" | "start_new_game" | "chat_only".
- For reveal_cell, toggle_flag, and chord_cell: also include action.cell as a string "row,col" (e.g. "3,5"), chosen from the schema's enum for that kind. The schema's enum already excludes any cell that is not a legal target for the kind you picked, so picking from it cannot be wrong.
- For start_new_game: also include action.difficulty ("beginner" | "intermediate" | "expert"). Do NOT include cell.
- For chat_only: include only kind. Do NOT include cell.
- Use "chat_only" when the user just wants to talk, or when no certain move can be derived from the constraint digest.

Rules:
- Row indexes count top-down, column indexes left-to-right, all zero-based.
- The schema enforces legal targets per kind, but reason like this: reveal_cell uses a hidden cell; toggle_flag uses a hidden or flagged cell; chord_cell uses a revealed number cell whose adjacent flags already equal its number.
- Only reveal cells you are confident are safe. Flag cells you can prove hide a mine.
- Flagging is a productive move and often the right answer. Look for forced flags first: for any revealed number N at (r,c), if the count of its hidden neighbours plus the count of its already-flagged neighbours equals N, then EVERY hidden neighbour is a mine — pick one and toggle_flag it. Place flags before guessing reveals.
- After flagging, re-check: for any revealed number N at (r,c), if it already has N flagged neighbours, every other hidden neighbour is provably safe and is a great reveal_cell target.
- If no safe move is certain, prefer "chat_only" and explain your reasoning instead of guessing.
- The board snapshot in the current user turn is the only source of truth. Never rely on memory of past board states.
- When a "Constraint digest" section is present, consult it FIRST. Each row reads "(r,c)=N · flags: K · hidden: (..),(..) · needs M more mine(s)". Forced rules: if needs == 0, every hidden cell in that row is safe (reveal one); if needs equals the count of hidden cells in that row, every hidden cell is a mine (flag one). Cite the (r,c) of the digest row your move comes from in your reasoning.- When a "Mine probability estimates" section is present, use it for guessing: lower % = safer. When no forced move exists, reveal the cell with the lowest probability (top of the list). Never refuse to act — a probabilistic guess is always preferable to inaction.- Board legend: "." hidden, "F" flagged, "_" revealed empty, "1"-"8" adjacent-mine count, "*" revealed mine. The grid is provided as a sanity check, not for visual counting.`;

function encodeCellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function collectCellEnums(view: PublicBoardView): {
  hidden: string[];
  flagTargets: string[];
  revealedNumbers: string[];
} {
  const hidden: string[] = [];
  const flagged: string[] = [];
  const revealedNumbers: string[] = [];
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) {
      const cell = view.cells[r][c];
      const key = encodeCellKey(r, c);
      if (cell.state === "hidden") hidden.push(key);
      else if (cell.state === "flagged") flagged.push(key);
      else if (cell.state === "revealed-number") revealedNumbers.push(key);
    }
  }
  return { hidden, flagTargets: [...hidden, ...flagged], revealedNumbers };
}

/**
 * Build the JSON Schema constraining the model's output for the current turn.
 *
 * The schema is a tagged union (`oneOf`) over action kinds. Each branch with a
 * cell field carries a string enum encoding the *legal targets for that kind*
 * on this exact board:
 *   - reveal_cell  → hidden cells only
 *   - toggle_flag  → hidden cells ∪ flagged cells
 *   - chord_cell   → revealed-number cells only
 *   - chat_only    → no cell
 *   - start_new_game → no cell, difficulty enum
 *
 * Branches whose target enum would be empty are omitted entirely so the model
 * can't pick them. Constrained decoding in the Prompt API enforces this during
 * generation, so an invalid-target move is structurally ungenerable.
 *
 * Cell coordinates are encoded as "row,col" strings rather than integer pairs:
 * a JSON-Schema string enum reliably encodes *pair* validity, while separate
 * integer enums on row/col can only constrain each axis independently.
 */
export function buildAgentResponseSchema(
  view: PublicBoardView,
): Record<string, unknown> {
  const { hidden, flagTargets, revealedNumbers } = collectCellEnums(view);

  const branches: Record<string, unknown>[] = [
    {
      type: "object",
      required: ["kind"],
      additionalProperties: false,
      properties: {
        kind: { const: "chat_only" },
      },
    },
    {
      type: "object",
      required: ["kind", "difficulty"],
      additionalProperties: false,
      properties: {
        kind: { const: "start_new_game" },
        difficulty: { type: "string", enum: [...AGENT_DIFFICULTIES] },
      },
    },
  ];

  if (hidden.length > 0) {
    branches.push({
      type: "object",
      required: ["kind", "cell"],
      additionalProperties: false,
      properties: {
        kind: { const: "reveal_cell" },
        cell: { type: "string", enum: hidden },
      },
    });
  }

  if (flagTargets.length > 0) {
    branches.push({
      type: "object",
      required: ["kind", "cell"],
      additionalProperties: false,
      properties: {
        kind: { const: "toggle_flag" },
        cell: { type: "string", enum: flagTargets },
      },
    });
  }

  if (revealedNumbers.length > 0) {
    branches.push({
      type: "object",
      required: ["kind", "cell"],
      additionalProperties: false,
      properties: {
        kind: { const: "chord_cell" },
        cell: { type: "string", enum: revealedNumbers },
      },
    });
  }

  return {
    type: "object",
    required: ["reasoning", "action"],
    additionalProperties: false,
    properties: {
      reasoning: { type: "string" },
      action: { oneOf: branches },
    },
  };
}

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
    blank +
    " |" +
    Array.from(
      { length: view.cols },
      (_, c) => " " + pad(String(c), colWidth),
    ).join("");

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
  // Always emit the full list. A flat coord list is far easier for the model
  // to parse than counting "." glyphs out of a 2D ASCII grid; truncating here
  // is what previously caused the model to target already-revealed cells.
  return `Hidden cells (valid reveal targets — only target coords from this list): ${hidden.join(", ")}`;
}

/**
 * Format the top N safest cells by estimated mine probability. Shown to the
 * LLM in auto/help mode so it can pick the best guess when no forced move
 * exists. We cap at 15 entries to keep the prompt concise.
 */
function formatProbabilitySection(view: PublicBoardView): string {
  const constraints = buildConstraints(view);
  const probs = estimateMineProbabilities(view, constraints);
  if (probs.size === 0) return "";

  const entries = [...probs.entries()]
    .map(([idx, prob]) => ({
      row: Math.floor(idx / view.cols),
      col: idx % view.cols,
      prob,
    }))
    .sort((a, b) => a.prob - b.prob);

  const CAP = 15;
  const shown = entries.slice(0, CAP);
  const lines = shown.map(
    ({ row, col, prob }) => `  (${row},${col}) = ${(prob * 100).toFixed(1)}%`,
  );
  const footer =
    entries.length > CAP
      ? `  … ${entries.length - CAP} more cells not shown`
      : "";

  return [
    "Mine probability estimates (lowest % = safest; pick from top when forced to guess):",
    ...lines,
    ...(footer ? [footer] : []),
  ].join("\n");
}

export function composeUserMessage(
  engine: MinesweeperEngine,
  text: string,
  mode?: ChatMode,
): string {
  const view = engine.getPublicView();
  const board = formatBoardAsText(view);
  const hiddenSection = describeHiddenCells(view);
  const hint = mode ? MODE_HINTS[mode] : "";
  const prefix = hint ? `${hint}\n\n` : "";
  // Order matters: in auto/help we lead with the structured constraint digest,
  // probability estimates, and the legal-target list, then the ASCII board as
  // a sanity check. The model is far better at reading flat lists than counting
  // glyphs in a 2D grid, so we want it to commit to the lists before the grid.
  if (mode === "auto" || mode === "help") {
    const digest = formatConstraintDigest(view);
    const probSection = formatProbabilitySection(view);
    const head = prefix || "";
    return (
      `${head}${digest}\n\n` +
      (probSection ? `${probSection}\n\n` : "") +
      `${hiddenSection}\n\n` +
      `Current board (sanity check only — pick coords from the lists above, not by reading the grid):\n` +
      `${board}\n\n` +
      `User: ${text}`
    );
  }
  return `${prefix}Current board:\n${board}\n\n${hiddenSection}\n\nUser: ${text}`;
}

export type AgentActionValidation =
  | { ok: true }
  | { ok: false; reason: string };

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
      // Preferred wire shape: action.cell as "row,col" string (the schema
      // enforces it). Legacy fallback: separate row/col integers — kept so
      // we don't hard-fail on a model regression.
      let row: number;
      let col: number;
      if (typeof a.cell === "string") {
        const parts = a.cell.split(",");
        if (parts.length !== 2) {
          throw new Error(`${a.kind}.cell must be "row,col" (got "${a.cell}")`);
        }
        row = Number(parts[0]);
        col = Number(parts[1]);
      } else {
        row = Number(a.row);
        col = Number(a.col);
      }
      if (!Number.isInteger(row) || !Number.isInteger(col)) {
        throw new Error(
          `${a.kind} requires integer row and col (got cell=${JSON.stringify(a.cell)}, row=${JSON.stringify(a.row)}, col=${JSON.stringify(a.col)})`,
        );
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
  source: "agent" | "solver" | "guess" = "agent",
): ActionResult | null {
  switch (action.kind) {
    case "reveal_cell":
      return engine.reveal(action.row, action.col, source);
    case "toggle_flag":
      return engine.toggleFlag(action.row, action.col, source);
    case "chord_cell":
      return engine.chord(action.row, action.col, source);
    case "start_new_game":
      return engine.newGame(
        { difficulty: action.difficulty as Difficulty },
        "agent",
      );
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
