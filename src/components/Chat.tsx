import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { MinesweeperEngine } from "../game/engine";
import {
  createChatSession,
  probeAvailability,
  type ChatAvailability,
  type ChatMode,
} from "../chat/session";
import {
  runAgentTurn,
  type AgentTurnEvents,
  type AutoPlayReason,
  type AutoStrategy,
} from "../chat/agent";
import { useAutoPlay } from "../hooks/useAutoPlay";

interface ChatProps {
  engine: MinesweeperEngine;
  onAutoPlayChange?: (active: boolean) => void;
}

type Role = "user" | "assistant" | "action";

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  pending?: boolean;
}

function nextId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function describeAvailability(state: ChatAvailability): string {
  switch (state) {
    case "unsupported":
      return "unsupported";
    case "unavailable":
      return "unavailable";
    case "downloadable":
      return "ready to download";
    case "downloading":
      return "downloading";
    case "available":
      return "available";
  }
}

const HELP_SUGGEST_PROMPT =
  "What's my safest next move? Reveal it if safe, otherwise flag a mine you can deduce. If no certain move exists, explain why.";

const MODES: { value: ChatMode; label: string; hint: string }[] = [
  { value: "help", label: "Help", hint: "Suggest one move on demand." },
  { value: "auto", label: "Auto", hint: "AI plays the game by itself." },
  { value: "chat", label: "Chat", hint: "Discuss the board (no moves)." },
];

const STRATEGIES: { value: AutoStrategy; label: string; hint: string }[] = [
  {
    value: "solver",
    label: "Solver",
    hint: "Deterministic constraint-propagation solver. Never guesses, pauses on ambiguity.",
  },
  {
    value: "llm",
    label: "AI",
    hint: "Browser language model plays autonomously. Slower, sometimes wrong.",
  },
];

function autoCompleteSummary(
  reason: AutoPlayReason,
  moves: number,
  lastMessage: string,
  strategy: AutoStrategy,
): string {
  const movesLabel = `${moves} move${moves === 1 ? "" : "s"}`;
  const actor = strategy === "solver" ? "Solver" : "AI";
  switch (reason) {
    case "won":
      return `${actor} won in ${movesLabel}. ${lastMessage}`.trim();
    case "lost":
      return `${actor} lost on move ${moves}. ${lastMessage}`.trim();
    case "chat_only":
      return strategy === "solver"
        ? "Solver paused — no forced move on this board. Play one yourself, then resume."
        : "AI paused — no certain move. Click Resume to continue, or play a move yourself first.";
    case "aborted":
      return `Auto-play stopped after ${movesLabel}.`;
    case "invalid":
      return `Auto-play stopped after ${movesLabel} — repeated invalid moves.`;
    case "cap":
      return `Auto-play stopped after ${movesLabel} — iteration cap reached.`;
    case "error":
      return `Auto-play stopped after ${movesLabel} due to an error.`;
  }
}

export function Chat({ engine, onAutoPlayChange }: ChatProps) {
  const [mode, setMode] = useState<ChatMode>("help");
  const [autoStrategy, setAutoStrategy] = useState<AutoStrategy>("solver");
  const [availability, setAvailability] = useState<ChatAvailability>("unsupported");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadFraction, setDownloadFraction] = useState<number | null>(null);

  const sessionRef = useRef<LanguageModel | null>(null);
  const sessionPromiseRef = useRef<Promise<LanguageModel> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const disposedRef = useRef(false);
  const lastNewGameTsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    probeAvailability().then((state) => {
      if (!cancelled) setAvailability(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      abortRef.current?.abort();
      sessionRef.current?.destroy();
      sessionRef.current = null;
      sessionPromiseRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return engine.subscribe((state) => {
      const last = state.lastAction;
      if (!last || last.kind !== "new-game") return;
      if (last.timestamp === lastNewGameTsRef.current) return;
      lastNewGameTsRef.current = last.timestamp;
      setMessages([]);
      setError(null);
    });
  }, [engine]);

  const ensureSession = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    if (sessionPromiseRef.current) return sessionPromiseRef.current;

    const controller = new AbortController();
    abortRef.current = controller;

    const promise = createChatSession({
      signal: controller.signal,
      onDownloadProgress: (fraction) => {
        if (disposedRef.current) return;
        setAvailability("downloading");
        setDownloadFraction(fraction);
      },
    });

    sessionPromiseRef.current = promise;

    try {
      const session = await promise;
      if (disposedRef.current) {
        session.destroy();
        throw new DOMException("Chat unmounted before session ready.", "AbortError");
      }
      sessionRef.current = session;
      setAvailability("available");
      setDownloadFraction(null);
      return session;
    } catch (err) {
      sessionPromiseRef.current = null;
      throw err;
    }
  }, []);

  const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, ...patch } : msg)),
    );
  }, []);

  const events: AgentTurnEvents = useMemo(
    () => ({
      onAssistantStart: (id) =>
        setMessages((prev) => [
          ...prev,
          { id, role: "assistant", text: "", pending: true },
        ]),
      onAssistantDelta: (id, accumulated) =>
        updateMessage(id, { text: accumulated }),
      onAssistantDone: (id, parsed) =>
        updateMessage(id, {
          text: parsed.reasoning || "(no reasoning provided)",
          pending: false,
        }),
      onActionLog: (text) =>
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "action", text },
        ]),
      onError: (id, message) =>
        updateMessage(id, { text: message, pending: false }),
    }),
    [updateMessage],
  );

  const handleAutoComplete = useCallback(
    (reason: AutoPlayReason, moves: number) => {
      const lastMsg = engine.getState().lastAction?.message ?? "";
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "action",
          text: autoCompleteSummary(reason, moves, lastMsg, autoStrategy),
        },
      ]);
    },
    [engine, autoStrategy],
  );

  const auto = useAutoPlay({
    engine,
    ensureSession,
    events,
    autoStrategy,
    onComplete: handleAutoComplete,
  });

  useEffect(() => {
    onAutoPlayChange?.(auto.isRunning);
  }, [auto.isRunning, onAutoPlayChange]);

  useEffect(() => {
    if (mode !== "auto" && auto.isRunning) {
      auto.stop();
    }
  }, [mode, auto]);

  const submit = useCallback(
    async (text: string) => {
      if (mode === "auto") return;
      const trimmed = text.trim();
      if (!trimmed || isBusy || auto.isRunning) return;
      setError(null);

      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "user", text: trimmed },
      ]);
      setInput("");
      setIsBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const session = await ensureSession();
        const outcome = await runAgentTurn(session, engine, {
          mode,
          userText: trimmed,
          signal: controller.signal,
          events,
          newId: nextId,
        });
        if (outcome.status === "error") {
          setError(outcome.message);
        }
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        const message = aborted
          ? "Cancelled."
          : err instanceof Error
            ? err.message
            : String(err);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.pending
              ? { ...msg, text: aborted ? "(cancelled)" : `Error: ${message}`, pending: false }
              : msg,
          ),
        );
        if (!aborted) setError(message);
      } finally {
        abortRef.current = null;
        setIsBusy(false);
      }
    },
    [mode, isBusy, auto.isRunning, ensureSession, events, engine],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit(input);
    },
    [input, submit],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit(input);
      }
    },
    [input, submit],
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const handleSuggestMove = useCallback(() => {
    void submit(HELP_SUGGEST_PROMPT);
  }, [submit]);

  const statusLabel = useMemo(
    () => describeAvailability(availability),
    [availability],
  );

  const disabled = availability === "unsupported" || availability === "unavailable";

  const helpSuggestions = [
    "What's my safest next move?",
    "Flag any obvious mines you can see.",
    "Explain the current board state.",
  ];

  const chatSuggestions = [
    "Explain the current board state.",
    "Which numbers tell us most about hidden mines?",
    "What's a good general Minesweeper strategy?",
  ];

  const suggestions = mode === "chat" ? chatSuggestions : helpSuggestions;

  const sendSuggestion = useCallback(
    (text: string) => {
      if (disabled || isBusy || auto.isRunning) return;
      setInput(text);
      void submit(text);
    },
    [disabled, isBusy, auto.isRunning, submit],
  );

  const placeholder = useMemo(() => {
    if (disabled) return "Prompt API unavailable";
    if (mode === "chat") return "Ask the assistant about the board… (no moves will be made)";
    return "Ask the assistant to play a move… (Enter to send, Shift+Enter for newline)";
  }, [disabled, mode]);

  return (
    <div className="panel chat">
      <div className="chat-header">
        <div className="chat-title">AI Assistant</div>
        <div className={`chat-status ${availability}`}>
          <span className="chat-dot" /> {statusLabel}
        </div>
      </div>

      <div className="chat-modes" role="tablist" aria-label="Assistant mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={mode === m.value}
            className={`chat-mode-btn ${mode === m.value ? "active" : ""}`}
            onClick={() => setMode(m.value)}
            disabled={disabled}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>

      {availability === "unsupported" && (
        <div className="chat-notice warn">
          The browser Prompt API (<code>window.LanguageModel</code>) is not
          exposed here. Try Chrome with built-in AI enabled.
        </div>
      )}

      {availability === "unavailable" && (
        <div className="chat-notice warn">
          The Prompt API is present but no model is available for text in
          English on this device.
        </div>
      )}

      {downloadFraction != null && (
        <div className="chat-progress" aria-label="Model download progress">
          <div
            className="chat-progress-bar"
            style={{ width: `${Math.round(downloadFraction * 100)}%` }}
          />
        </div>
      )}

      <div className="chat-messages" ref={scrollerRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            {mode === "auto"
              ? "Click Start auto-play and let the AI sweep the field."
              : mode === "chat"
                ? "Discuss strategy or the current board. The AI will not make any moves."
                : "Ask the assistant to reveal a cell, flag a suspicious square, or explain what it sees."}
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              <span className="chat-role">{msg.role}</span>
              <span className="chat-text">
                {msg.text}
                {msg.pending && <span className="chat-cursor">▍</span>}
              </span>
            </div>
          ))
        )}
      </div>

      {error && <div className="chat-notice error">{error}</div>}

      {mode === "auto" ? (
        <div className="chat-auto">
          <div
            className="chat-strategy"
            role="radiogroup"
            aria-label="Auto-play strategy"
          >
            <span className="chat-strategy-label">Strategy</span>
            {STRATEGIES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={autoStrategy === s.value}
                className={`chat-strategy-btn ${autoStrategy === s.value ? "active" : ""}`}
                onClick={() => setAutoStrategy(s.value)}
                disabled={disabled || auto.isRunning}
                title={s.hint}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="chat-auto-status">
            {auto.isRunning ? (
              <>
                <span className="chat-auto-dot running" />
                Auto-play running · {autoStrategy === "solver" ? "solver" : "AI"} · moves: {auto.moveCount}
              </>
            ) : auto.isPaused ? (
              <>
                <span className="chat-auto-dot paused" />
                Paused — {autoStrategy === "solver" ? "no forced move" : "no certain move"}. Resume to retry.
              </>
            ) : auto.lastReason ? (
              <>
                <span className="chat-auto-dot done" />
                Stopped ({auto.lastReason}) · {autoStrategy === "solver" ? "solver" : "AI"} · moves: {auto.moveCount}
              </>
            ) : (
              <>
                <span className="chat-auto-dot idle" />
                Idle — press Start to let the {autoStrategy === "solver" ? "solver" : "AI"} play.
              </>
            )}
          </div>
          <div className="chat-actions">
            {auto.isRunning ? (
              <button type="button" className="menu-btn" onClick={auto.stop}>
                Stop
              </button>
            ) : auto.isPaused ? (
              <>
                <button
                  type="button"
                  className="menu-btn primary"
                  onClick={auto.start}
                  disabled={disabled}
                >
                  Resume
                </button>
                <button type="button" className="menu-btn" onClick={auto.stop}>
                  Reset
                </button>
              </>
            ) : (
              <button
                type="button"
                className="menu-btn primary"
                onClick={auto.start}
                disabled={disabled}
              >
                Start auto-play
              </button>
            )}
            <button
              type="button"
              className="menu-btn"
              onClick={handleClear}
              disabled={auto.isRunning || messages.length === 0}
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        <>
          {!disabled && messages.length === 0 && (
            <div className="chat-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chat-chip"
                  onClick={() => sendSuggestion(s)}
                  disabled={isBusy}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form className="chat-form" onSubmit={handleSubmit}>
            <textarea
              className="chat-input"
              placeholder={placeholder}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled || isBusy}
              rows={2}
            />
            <div className="chat-actions">
              {mode === "help" && (
                <button
                  type="button"
                  className="menu-btn"
                  onClick={handleSuggestMove}
                  disabled={disabled || isBusy}
                  title="Ask the AI for the best next move"
                >
                  Suggest move
                </button>
              )}
              {isBusy ? (
                <button
                  type="button"
                  className="menu-btn"
                  onClick={handleCancel}
                  aria-label="Cancel"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="submit"
                  className="menu-btn primary"
                  disabled={disabled || !input.trim()}
                >
                  Send
                </button>
              )}
              <button
                type="button"
                className="menu-btn"
                onClick={handleClear}
                disabled={isBusy || messages.length === 0}
              >
                Clear
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
