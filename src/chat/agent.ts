import type { ActionResult, MinesweeperEngine } from "../game/engine";
import {
  AGENT_RESPONSE_SCHEMA,
  composeUserMessage,
  describeAgentAction,
  dispatchAgentAction,
  formatBoardAsText,
  parseAgentResponse,
  validateAgentAction,
  type AgentAction,
  type AgentResponse,
  type ChatMode,
} from "./session";

export interface AgentTurnEvents {
  onAssistantStart: (id: string) => void;
  onAssistantDelta: (id: string, accumulated: string) => void;
  onAssistantDone: (id: string, parsed: AgentResponse) => void;
  onActionLog: (text: string) => void;
  onError: (id: string, message: string) => void;
}

export interface RunAgentTurnOptions {
  mode: ChatMode;
  userText: string;
  signal: AbortSignal;
  events: AgentTurnEvents;
  newId: () => string;
}

export type AgentTurnOutcome =
  | { status: "dispatched"; action: AgentAction; result: ActionResult | null }
  | { status: "chat_only"; reasoning: string }
  | { status: "invalid"; reason: string }
  | { status: "aborted" }
  | { status: "error"; message: string };

async function streamPrompt(
  session: LanguageModel,
  promptText: string,
  signal: AbortSignal,
  assistantId: string,
  events: AgentTurnEvents,
): Promise<string> {
  const stream = session.promptStreaming(promptText, {
    signal,
    responseConstraint: AGENT_RESPONSE_SCHEMA,
  });
  let accumulated = "";
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (typeof value === "string") {
        accumulated += value;
        events.onAssistantDelta(assistantId, accumulated);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return accumulated;
}

function listHiddenCoords(engine: MinesweeperEngine): string {
  const view = engine.getPublicView();
  const out: string[] = [];
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) {
      if (view.cells[r][c].state === "hidden") out.push(`(${r},${c})`);
    }
  }
  if (out.length === 0) return "(none — every cell is revealed or flagged)";
  if (out.length > 200) {
    return `${out.slice(0, 200).join(", ")}, … (+${out.length - 200} more — read the ASCII board)`;
  }
  return out.join(", ");
}

function composeSolverMessage(engine: MinesweeperEngine): string {
  const view = engine.getPublicView();
  const board = formatBoardAsText(view);
  return [
    "DEDUCTION TASK: find ONE provably-forced move on the current board. Do NOT guess.",
    "",
    "A move is forced only when one of these two rules applies:",
    "  • Forced flag: a revealed number N at (r,c) where the count of (hidden + flagged) neighbours equals N — every hidden neighbour MUST be a mine. Pick one and reply with toggle_flag.",
    "  • Forced safe reveal: a revealed number N at (r,c) where the count of flagged neighbours already equals N — every remaining hidden neighbour MUST be safe. Pick one and reply with reveal_cell.",
    "",
    "If neither rule produces a forced move on this board, reply with action.kind = \"chat_only\" and reasoning = \"no forced move\".",
    "",
    "Cite the (r,c) of the number that forces your choice in the reasoning. Reply ONLY with the JSON action.",
    "",
    "Current board:",
    board,
    "",
    `Hidden coordinates available: ${listHiddenCoords(engine)}`,
  ].join("\n");
}

/**
 * Dedicated Prompt-API solver pass: ask the model to find one provably forced
 * move (or chat_only if none). Runs before the main strategist call to handle
 * deterministic positions reliably and to keep flagging in the rotation.
 *
 * Returns:
 *   - "dispatched" outcome on a successful, validated forced move (caller stops),
 *   - null on chat_only / unsupported action / invalid coords (caller falls
 *     through to the strategist),
 *   - propagates aborted/error outcomes so the caller can short-circuit.
 */
async function runSolverTurn(
  masterSession: LanguageModel,
  engine: MinesweeperEngine,
  signal: AbortSignal,
  events: AgentTurnEvents,
  newId: () => string,
): Promise<AgentTurnOutcome | null> {
  let session: LanguageModel = masterSession;
  let ownsSession = false;
  try {
    session = await masterSession.clone({ signal });
    ownsSession = true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { status: "aborted" };
    }
    console.warn("[minesweeper] solver clone failed; using master session", err);
  }

  const id = newId();
  events.onAssistantStart(id);

  try {
    const raw = await streamPrompt(
      session,
      composeSolverMessage(engine),
      signal,
      id,
      events,
    );

    let parsed: AgentResponse;
    try {
      parsed = parseAgentResponse(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      events.onError(id, `Solver parse error (${reason}):\n${raw || "(empty)"}`);
      return null; // fall through to strategist
    }

    // Tag the assistant bubble so the user can tell solver bubbles from
    // strategist bubbles.
    events.onAssistantDone(id, {
      reasoning: `Solver: ${parsed.reasoning || "(no reasoning)"}`,
      action: parsed.action,
    });

    const action = parsed.action;
    if (action.kind === "chat_only") {
      // No forced move — let the strategist try.
      return null;
    }
    if (action.kind !== "reveal_cell" && action.kind !== "toggle_flag") {
      // Solver should only return reveal/flag/chat_only. Anything else (chord,
      // start_new_game) is treated as no forced move — fall to strategist.
      return null;
    }

    const validation = validateAgentAction(engine, action);
    if (!validation.ok) {
      events.onActionLog(
        `Solver suggestion invalid (${validation.reason}); deferring to strategist.`,
      );
      return null;
    }

    const summary = describeAgentAction(action);
    const result = dispatchAgentAction(engine, action);
    const detail = result ? `${result.ok ? "✓" : "✗"} ${result.message}` : summary;
    events.onActionLog(`${summary} (solver) — ${detail}`);
    return { status: "dispatched", action, result };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { status: "aborted" };
    }
    const message = err instanceof Error ? err.message : String(err);
    events.onError(id, `Solver error: ${message}`);
    return null; // strategist may still recover
  } finally {
    if (ownsSession) {
      try {
        session.destroy();
      } catch {
        // ignore
      }
    }
  }
}

export async function runAgentTurn(
  masterSession: LanguageModel,
  engine: MinesweeperEngine,
  opts: RunAgentTurnOptions,
): Promise<AgentTurnOutcome> {
  const { mode, userText, signal, events, newId } = opts;

  // Dedicated solver pass via Prompt API — in help/auto modes, ask the model
  // to find one provably-forced move first. If it does, dispatch directly and
  // skip the strategist call. Aborted/dispatched outcomes short-circuit;
  // null falls through to the strategist below.
  if (mode !== "chat") {
    const solverOutcome = await runSolverTurn(masterSession, engine, signal, events, newId);
    if (solverOutcome?.status === "aborted") return solverOutcome;
    if (solverOutcome?.status === "dispatched") return solverOutcome;
  }

  // Per-turn clone so the model sees only the system prompt + this turn's
  // user message. Across turns this avoids stale board snapshots in history.
  let session: LanguageModel = masterSession;
  let ownsSession = false;
  try {
    session = await masterSession.clone({ signal });
    ownsSession = true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { status: "aborted" };
    }
    console.warn("[minesweeper] session.clone() failed; using master session", err);
  }

  const firstId = newId();
  events.onAssistantStart(firstId);

  try {
    const firstRaw = await streamPrompt(
      session,
      composeUserMessage(engine, userText, mode),
      signal,
      firstId,
      events,
    );

    let parsed: AgentResponse;
    try {
      parsed = parseAgentResponse(firstRaw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      events.onError(firstId, `Could not parse response (${reason}):\n${firstRaw || "(empty)"}`);
      return { status: "error", message: `Parse error: ${reason}` };
    }
    events.onAssistantDone(firstId, parsed);

    let action = parsed.action;

    // Coerce in chat mode: any non-chat action is a suggestion only.
    if (mode === "chat" && action.kind !== "chat_only") {
      events.onActionLog(
        `(chat mode, action ignored) ${describeAgentAction(action)}`,
      );
      return { status: "chat_only", reasoning: parsed.reasoning };
    }

    // Filter start_new_game in auto mode — surprise resets are bad UX.
    if (mode === "auto" && action.kind === "start_new_game") {
      events.onActionLog(
        "(auto mode) Ignored start_new_game suggestion — pausing instead.",
      );
      return { status: "chat_only", reasoning: parsed.reasoning };
    }

    let validation = validateAgentAction(engine, action);
    if (!validation.ok) {
      events.onActionLog(`Invalid suggestion: ${validation.reason} Retrying…`);

      const retryId = newId();
      events.onAssistantStart(retryId);

      const retryPrompt =
        `Your previous action was invalid: ${validation.reason}\n` +
        `Pick again. The cells you may target right now are exactly: ${listHiddenCoords(engine)}.\n` +
        `Reply with a different action — only target a coordinate from that list, or use "chat_only" if no safe move is certain.`;

      let retryRaw: string;
      try {
        retryRaw = await streamPrompt(session, retryPrompt, signal, retryId, events);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { status: "aborted" };
        }
        throw err;
      }

      let retryParsed: AgentResponse;
      try {
        retryParsed = parseAgentResponse(retryRaw);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        events.onError(retryId, `Could not parse response (${reason}):\n${retryRaw || "(empty)"}`);
        return { status: "error", message: `Parse error: ${reason}` };
      }
      events.onAssistantDone(retryId, retryParsed);

      action = retryParsed.action;

      if (mode === "chat" && action.kind !== "chat_only") {
        events.onActionLog(
          `(chat mode, action ignored) ${describeAgentAction(action)}`,
        );
        return { status: "chat_only", reasoning: retryParsed.reasoning };
      }

      if (mode === "auto" && action.kind === "start_new_game") {
        events.onActionLog(
          "(auto mode) Ignored start_new_game suggestion — pausing instead.",
        );
        return { status: "chat_only", reasoning: retryParsed.reasoning };
      }

      validation = validateAgentAction(engine, action);
      if (!validation.ok) {
        events.onActionLog(`Still invalid after retry: ${validation.reason} Skipping action.`);
        return { status: "invalid", reason: validation.reason };
      }
    }

    if (action.kind === "chat_only") {
      return { status: "chat_only", reasoning: parsed.reasoning };
    }

    const summary = describeAgentAction(action);
    const result = dispatchAgentAction(engine, action);
    const detail = result ? `${result.ok ? "✓" : "✗"} ${result.message}` : summary;
    events.onActionLog(`${summary} — ${detail}`);

    return { status: "dispatched", action, result };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { status: "aborted" };
    }
    const message = err instanceof Error ? err.message : String(err);
    events.onError(firstId, `Error: ${message}`);
    return { status: "error", message };
  } finally {
    if (ownsSession) {
      try {
        session.destroy();
      } catch {
        // ignore — session may already be torn down
      }
    }
  }
}

export interface RunAutoPlayOptions {
  signal: AbortSignal;
  events: AgentTurnEvents;
  newId: () => string;
  delayMs?: number;
  maxIterations?: number;
  onMove?: (n: number, outcome: AgentTurnOutcome) => void;
}

export type AutoPlayReason =
  | "won"
  | "lost"
  | "chat_only"
  | "aborted"
  | "invalid"
  | "cap"
  | "error";

export interface AutoPlayResult {
  moves: number;
  reason: AutoPlayReason;
}

const AUTO_PROMPT = "Play your next move.";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort);
  });
}

export async function runAutoPlay(
  session: LanguageModel,
  engine: MinesweeperEngine,
  opts: RunAutoPlayOptions,
): Promise<AutoPlayResult> {
  const { signal, events, newId, onMove } = opts;
  const delayMs = opts.delayMs ?? 250;
  const view = engine.getPublicView();
  const cap = opts.maxIterations ?? view.rows * view.cols;

  let moves = 0;
  let consecutiveInvalid = 0;

  while (true) {
    if (signal.aborted) return { moves, reason: "aborted" };

    const status = engine.getState().status;
    if (status === "won") return { moves, reason: "won" };
    if (status === "lost") return { moves, reason: "lost" };

    if (moves >= cap) {
      events.onActionLog(`Auto-play stopped: iteration cap (${cap}) reached.`);
      return { moves, reason: "cap" };
    }

    const outcome = await runAgentTurn(session, engine, {
      mode: "auto",
      userText: AUTO_PROMPT,
      signal,
      events,
      newId,
    });

    if (outcome.status === "aborted") return { moves, reason: "aborted" };
    if (outcome.status === "chat_only") return { moves, reason: "chat_only" };
    if (outcome.status === "error") return { moves, reason: "error" };

    if (outcome.status === "invalid") {
      consecutiveInvalid++;
      if (consecutiveInvalid >= 2) {
        events.onActionLog(
          "Auto-play stopped: AI produced invalid moves twice in a row.",
        );
        return { moves, reason: "invalid" };
      }
      continue;
    }

    consecutiveInvalid = 0;
    moves++;
    onMove?.(moves, outcome);

    const newStatus = engine.getState().status;
    if (newStatus === "won" || newStatus === "lost") {
      return { moves, reason: newStatus };
    }

    try {
      await sleep(delayMs, signal);
    } catch {
      return { moves, reason: "aborted" };
    }
  }
}
