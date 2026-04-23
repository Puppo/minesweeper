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
  AGENT_RESPONSE_SCHEMA,
  composeUserMessage,
  createChatSession,
  describeAgentAction,
  dispatchAgentAction,
  parseAgentResponse,
  probeAvailability,
  type ChatAvailability,
} from "../chat/session";

interface ChatProps {
  engine: MinesweeperEngine;
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

export function Chat({ engine }: ChatProps) {
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

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isBusy) return;
      setError(null);

      const userMessage: ChatMessage = {
        id: nextId(),
        role: "user",
        text: trimmed,
      };
      const assistantId = nextId();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        pending: true,
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setInput("");
      setIsBusy(true);

      const updateAssistant = (patch: Partial<ChatMessage>) => {
        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantId ? { ...msg, ...patch } : msg)),
        );
      };

      try {
        const session = await ensureSession();
        const controller = new AbortController();
        abortRef.current = controller;

        const composed = composeUserMessage(engine, trimmed);
        const stream = session.promptStreaming(composed, {
          signal: controller.signal,
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
              updateAssistant({ text: accumulated });
            }
          }
        } finally {
          reader.releaseLock();
        }

        let parsed;
        try {
          parsed = parseAgentResponse(accumulated);
        } catch (parseErr) {
          const reason =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          updateAssistant({
            text: `Could not parse response (${reason}):\n${accumulated || "(empty)"}`,
            pending: false,
          });
          setError(`Parse error: ${reason}`);
          return;
        }

        updateAssistant({
          text: parsed.reasoning || "(no reasoning provided)",
          pending: false,
        });

        if (parsed.action.kind !== "chat_only") {
          const summary = describeAgentAction(parsed.action);
          const result = dispatchAgentAction(engine, parsed.action);
          const detail = result
            ? `${result.ok ? "✓" : "✗"} ${result.message}`
            : summary;
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "action",
              text: `${summary} — ${detail}`,
            },
          ]);
        }
      } catch (err) {
        const aborted =
          err instanceof DOMException && err.name === "AbortError";
        const message = aborted
          ? "Cancelled."
          : err instanceof Error
            ? err.message
            : String(err);
        updateAssistant({
          text: aborted ? "(cancelled)" : `Error: ${message}`,
          pending: false,
        });
        if (!aborted) setError(message);
      } finally {
        abortRef.current = null;
        setIsBusy(false);
      }
    },
    [engine, ensureSession, isBusy],
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

  const statusLabel = useMemo(
    () => describeAvailability(availability),
    [availability],
  );

  const disabled = availability === "unsupported" || availability === "unavailable";

  const suggestions = [
    "What's my safest next move?",
    "Flag any obvious mines you can see.",
    "Explain the current board state.",
  ];

  const sendSuggestion = useCallback(
    (text: string) => {
      if (disabled || isBusy) return;
      setInput(text);
      void submit(text);
    },
    [disabled, isBusy, submit],
  );

  return (
    <div className="panel chat">
      <div className="chat-header">
        <div className="chat-title">AI Assistant</div>
        <div className={`chat-status ${availability}`}>
          <span className="chat-dot" /> {statusLabel}
        </div>
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
            Ask the assistant to reveal a cell, flag a suspicious square, or
            explain what it sees on the board.
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
          placeholder={
            disabled
              ? "Prompt API unavailable"
              : "Ask the assistant to play a move… (Enter to send, Shift+Enter for newline)"
          }
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isBusy}
          rows={2}
        />
        <div className="chat-actions">
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
    </div>
  );
}
