import type { ActionResult, MinesweeperEngine } from "../game/engine";
import {
  findBestGuess,
  findDeterministicMove,
  formatConstraintDigest,
} from "../game/solver";
import {
  buildAgentResponseSchema,
  composeUserMessage,
  describeAgentAction,
  dispatchAgentAction,
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

export type AutoStrategy = "solver" | "llm";

export interface RunAgentTurnOptions {
  mode: ChatMode;
  userText: string;
  signal: AbortSignal;
  events: AgentTurnEvents;
  newId: () => string;
  /**
   * Only consulted when `mode === "auto"`:
   *   - "solver": deterministic CSP solver only; pause if no forced move.
   *   - "llm":    LLM strategist only; no deterministic short-circuit.
   * Default: "solver".
   */
  autoStrategy?: AutoStrategy;
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
  responseConstraint: Record<string, unknown>,
): Promise<string> {
  const stream = session.promptStreaming(promptText, {
    signal,
    responseConstraint,
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
  // No truncation: a complete authoritative list keeps the retry prompt from
  // sending the model back to ASCII counting (which is what produced the
  // already-revealed-cell errors).
  return out.join(", ");
}

/**
 * Deterministic-solver pass. Synchronous, no LLM call: finds one provably-forced
 * move via constraint propagation (trivial + subset rules), or null if the
 * board has no forced move. Caller decides what to do with null:
 *   - auto mode: pause (chat_only),
 *   - help mode: fall through to the LLM strategist for advice.
 */
function runDeterministicSolverTurn(
  engine: MinesweeperEngine,
  events: AgentTurnEvents,
  newId: () => string,
): AgentTurnOutcome | null {
  const move = findDeterministicMove(engine.getPublicView());
  if (!move) return null;

  const action: AgentAction =
    move.kind === "flag"
      ? { kind: "toggle_flag", row: move.row, col: move.col }
      : move.kind === "chord"
        ? { kind: "chord_cell", row: move.row, col: move.col }
        : { kind: "reveal_cell", row: move.row, col: move.col };

  const id = newId();
  events.onAssistantStart(id);
  events.onAssistantDone(id, {
    reasoning: `Solver: ${move.reason}`,
    action,
  });

  // Defensive — the solver shouldn't ever produce an invalid action, but if a
  // caller mutated the engine between view-snapshot and dispatch, surface it
  // rather than crashing.
  const validation = validateAgentAction(engine, action);
  if (!validation.ok) {
    events.onActionLog(
      `Solver produced invalid move (${validation.reason}); skipping.`,
    );
    return null;
  }

  const summary = describeAgentAction(action);
  const result = dispatchAgentAction(engine, action, "solver");
  const detail = result
    ? `${result.ok ? "✓" : "✗"} ${result.message}`
    : summary;
  events.onActionLog(`${summary} (solver) — ${detail}`);
  return { status: "dispatched", action, result };
}

/**
 * Probabilistic fallback: reveal the hidden cell with the lowest estimated
 * mine probability. Used when no deterministically-forced move exists.
 * Returns null if there are no hidden cells (game should already be resolved).
 */
function runBestGuessTurn(
  engine: MinesweeperEngine,
  events: AgentTurnEvents,
  newId: () => string,
): AgentTurnOutcome | null {
  const guess = findBestGuess(engine.getPublicView());
  if (!guess) return null;

  const action: AgentAction = {
    kind: "reveal_cell",
    row: guess.row,
    col: guess.col,
  };
  const validation = validateAgentAction(engine, action);
  if (!validation.ok) return null;

  const id = newId();
  events.onAssistantStart(id);
  events.onAssistantDone(id, {
    reasoning: `Probabilistic guess: ${guess.reason}`,
    action,
  });

  const summary = describeAgentAction(action);
  const result = dispatchAgentAction(engine, action, "guess");
  const detail = result
    ? `${result.ok ? "✓" : "✗"} ${result.message}`
    : summary;
  events.onActionLog(`${summary} (probabilistic guess) — ${detail}`);
  return { status: "dispatched", action, result };
}

export async function runAgentTurn(
  masterSession: LanguageModel,
  engine: MinesweeperEngine,
  opts: RunAgentTurnOptions,
): Promise<AgentTurnOutcome> {
  const { mode, userText, signal, events, newId } = opts;
  const autoStrategy: AutoStrategy = opts.autoStrategy ?? "solver";

  // Run the deterministic solver only when the user explicitly chose
  // autoStrategy === "solver". In llm strategy and help mode the LLM is the
  // primary decision-maker; the solver must not silently pre-empt it.
  const useDeterministicSolver = mode === "auto" && autoStrategy === "solver";

  if (useDeterministicSolver) {
    const solverOutcome = runDeterministicSolverTurn(engine, events, newId);
    if (solverOutcome) return solverOutcome;
    if (mode === "auto" && autoStrategy === "solver") {
      // Solver-only mode: fall back to probabilistic best guess, then pause.
      const guessOutcome = runBestGuessTurn(engine, events, newId);
      if (guessOutcome) return guessOutcome;
      events.onActionLog(
        "No forced move found — pausing rather than guess. Play one yourself, then resume.",
      );
      return {
        status: "chat_only",
        reasoning: "No deterministically-forced move on this board.",
      };
    }
    // For auto+llm and help: fall through to the LLM path.
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
    console.warn(
      "[minesweeper] session.clone() failed; using master session",
      err,
    );
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
      buildAgentResponseSchema(engine.getPublicView()),
    );

    let parsed: AgentResponse;
    try {
      parsed = parseAgentResponse(firstRaw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      events.onError(
        firstId,
        `Could not parse response (${reason}):\n${firstRaw || "(empty)"}`,
      );
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

    // Filter start_new_game in auto+LLM — surprise resets are bad UX.
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

      const retryPrompt = [
        `Your previous action was invalid: ${validation.reason}`,
        "",
        formatConstraintDigest(engine.getPublicView()),
        "",
        `Hidden cells (the ONLY valid reveal targets): ${listHiddenCoords(engine)}`,
        "",
        "Pick again. Emit a coordinate that appears verbatim in the Hidden cells list, or reply with chat_only if no forced move can be derived from the digest.",
      ].join("\n");

      let retryRaw: string;
      try {
        retryRaw = await streamPrompt(
          session,
          retryPrompt,
          signal,
          retryId,
          events,
          buildAgentResponseSchema(engine.getPublicView()),
        );
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
        events.onError(
          retryId,
          `Could not parse response (${reason}):\n${retryRaw || "(empty)"}`,
        );
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
        events.onActionLog(
          `Still invalid after retry: ${validation.reason} Skipping action.`,
        );
        return { status: "invalid", reason: validation.reason };
      }
    }

    if (action.kind === "chat_only") {
      // In auto mode the LLM deferred — fall back to probabilistic best guess.
      if (mode === "auto") {
        const guessOutcome = runBestGuessTurn(engine, events, newId);
        if (guessOutcome) return guessOutcome;
      }
      return { status: "chat_only", reasoning: parsed.reasoning };
    }

    const summary = describeAgentAction(action);
    const result = dispatchAgentAction(engine, action, "agent");
    const detail = result
      ? `${result.ok ? "✓" : "✗"} ${result.message}`
      : summary;
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
  /** "solver" (default) or "llm" — see RunAgentTurnOptions.autoStrategy. */
  autoStrategy?: AutoStrategy;
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
  const autoStrategy: AutoStrategy = opts.autoStrategy ?? "solver";
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
      autoStrategy,
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
