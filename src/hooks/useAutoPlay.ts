import { useCallback, useEffect, useRef, useState } from "react";
import type { MinesweeperEngine } from "../game/engine";
import {
  runAutoPlay,
  type AgentTurnEvents,
  type AutoPlayReason,
} from "../chat/agent";

export interface UseAutoPlayOptions {
  engine: MinesweeperEngine;
  ensureSession: () => Promise<LanguageModel>;
  events: AgentTurnEvents;
  onComplete?: (reason: AutoPlayReason, moves: number) => void;
}

export interface AutoPlayController {
  isRunning: boolean;
  isPaused: boolean;
  moveCount: number;
  lastReason: AutoPlayReason | null;
  start: () => void;
  stop: () => void;
}

export function useAutoPlay(opts: UseAutoPlayOptions): AutoPlayController {
  const { engine, ensureSession, events, onComplete } = opts;
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [moveCount, setMoveCount] = useState(0);
  const [lastReason, setLastReason] = useState<AutoPlayReason | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setIsPaused(false);
    setLastReason(null);
    setMoveCount(0);

    void (async () => {
      try {
        const session = await ensureSession();
        if (controller.signal.aborted || disposedRef.current) return;

        const result = await runAutoPlay(session, engine, {
          signal: controller.signal,
          events,
          newId: () =>
            Math.random().toString(36).slice(2) + Date.now().toString(36),
          onMove: (n) => {
            if (disposedRef.current) return;
            setMoveCount(n);
          },
        });

        if (disposedRef.current) return;
        setLastReason(result.reason);
        setIsPaused(result.reason === "chat_only");
        onComplete?.(result.reason, result.moves);
      } catch (err) {
        if (disposedRef.current) return;
        const aborted = err instanceof DOMException && err.name === "AbortError";
        setLastReason(aborted ? "aborted" : "error");
      } finally {
        if (!disposedRef.current) {
          setIsRunning(false);
        }
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    })();
  }, [engine, ensureSession, events, onComplete]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsPaused(false);
  }, []);

  return { isRunning, isPaused, moveCount, lastReason, start, stop };
}
