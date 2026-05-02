import { useCallback, useEffect, useRef, useState } from "react";
import { Board } from "./components/Board";
import { Chat } from "./components/Chat";
import { DifficultyMenu } from "./components/DifficultyMenu";
import { Hud } from "./components/Hud";
import { ActionLog } from "./components/ActionLog";
import { useEngine } from "./hooks/useEngine";
import { useKeyboard } from "./hooks/useKeyboard";
import { registerWebMcpTools } from "./webmcp/register";
import type { Difficulty } from "./game/types";

const BEST_TIMES_KEY = "minesweeper:best-times";

type BestTimes = Partial<Record<Difficulty, number>>;

function loadBestTimes(): BestTimes {
  try {
    const raw = localStorage.getItem(BEST_TIMES_KEY);
    return raw ? (JSON.parse(raw) as BestTimes) : {};
  } catch {
    return {};
  }
}

function saveBestTimes(next: BestTimes): void {
  try {
    localStorage.setItem(BEST_TIMES_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export default function App() {
  const { engine } = useEngine();
  const state = engine.getState();
  const [mcpAvailable, setMcpAvailable] = useState(false);
  const [toolCount, setToolCount] = useState(0);
  const [flagMode, setFlagMode] = useState(false);
  const [bestTimes, setBestTimes] = useState<BestTimes>(() => loadBestTimes());
  const [isNewBest, setIsNewBest] = useState(false);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const lastStatusRef = useRef(state.status);

  useKeyboard(engine, autoPlaying);

  useEffect(() => {
    const handle = registerWebMcpTools(engine);
    setMcpAvailable(handle.available);
    setToolCount(handle.toolNames.length);
    if (handle.available && typeof window !== "undefined") {
      console.info(
        `[minesweeper] WebMCP tools registered: ${handle.toolNames.join(", ")}`,
      );
    }
    return () => handle.dispose();
  }, [engine]);

  useEffect(() => {
    const prev = lastStatusRef.current;
    lastStatusRef.current = state.status;
    if (state.status !== "won" || prev === "won") {
      if (state.status !== "won") setIsNewBest(false);
      return;
    }
    if (!state.startedAt || !state.endedAt) return;
    const elapsedSec = Math.floor((state.endedAt - state.startedAt) / 1000);
    const difficulty = state.config.difficulty;
    setBestTimes((current) => {
      const existing = current[difficulty];
      if (existing != null && existing <= elapsedSec) {
        setIsNewBest(false);
        return current;
      }
      const next = { ...current, [difficulty]: elapsedSec };
      saveBestTimes(next);
      setIsNewBest(true);
      return next;
    });
  }, [state.status, state.startedAt, state.endedAt, state.config.difficulty]);

  const onReveal = useCallback(
    (row: number, col: number) => {
      engine.moveCursor(row, col);
      engine.reveal(row, col, "human");
    },
    [engine],
  );
  const onFlag = useCallback(
    (row: number, col: number) => {
      engine.moveCursor(row, col);
      engine.toggleFlag(row, col, "human");
    },
    [engine],
  );
  const onChord = useCallback(
    (row: number, col: number) => {
      engine.moveCursor(row, col);
      engine.chord(row, col, "human");
    },
    [engine],
  );
  const onHover = useCallback(
    (row: number, col: number) => {
      engine.moveCursor(row, col);
    },
    [engine],
  );

  const onSelectDifficulty = useCallback(
    (difficulty: Difficulty) => {
      engine.newGame({ difficulty }, "human");
      setIsNewBest(false);
    },
    [engine],
  );

  const onCustomSelect = useCallback(
    (rows: number, cols: number, mines: number) => {
      engine.newGame({ difficulty: "custom", rows, cols, mines }, "human");
      setIsNewBest(false);
    },
    [engine],
  );

  const onReset = useCallback(() => {
    engine.newGame({ difficulty: state.config.difficulty }, "human");
    setIsNewBest(false);
  }, [engine, state.config.difficulty]);

  const onToggleFlagMode = useCallback(() => {
    setFlagMode((v) => !v);
  }, []);

  const bestTime = bestTimes[state.config.difficulty] ?? null;

  return (
    <div className="app">
      <div
        className={`mcp-badge ${mcpAvailable ? "" : "off"}`}
        title={
          mcpAvailable
            ? `${toolCount} WebMCP tools registered`
            : "WebMCP not available in this browser (Chrome 146+ with chrome://flags/#enable-webmcp-testing)"
        }
      >
        <span className="mcp-dot" />
        {mcpAvailable ? `WebMCP · ${toolCount} tools` : "WebMCP offline"}
      </div>

      <header className="header">
        <h1 className="title">MINESWEEPER</h1>
        <p className="subtitle">
          WebMCP edition · play with mouse, keyboard, or let an AI drive
        </p>
      </header>

      <div className="layout">
        <div className="main-col">
          <DifficultyMenu
            current={state.config.difficulty}
            onSelect={onSelectDifficulty}
            onCustomSelect={onCustomSelect}
          />
          <Hud
            state={state}
            onReset={onReset}
            flagMode={flagMode}
            onToggleFlagMode={onToggleFlagMode}
            bestTimeSeconds={bestTime}
          />
          <Board
            state={state}
            flagMode={flagMode}
            bestTimeSeconds={bestTime}
            isNewBest={isNewBest}
            interactive={!autoPlaying}
            onReveal={onReveal}
            onFlag={onFlag}
            onChord={onChord}
            onHover={onHover}
            onNewGame={onReset}
          />
          <div className="panel help">
            <span className="help-group">
              <kbd>←↑↓→</kbd> move
            </span>
            <span className="help-group">
              <kbd>Space</kbd>
              <kbd>↵</kbd> reveal
            </span>
            <span className="help-group">
              <kbd>F</kbd> flag
            </span>
            <span className="help-group">
              <kbd>C</kbd> chord
            </span>
            <span className="help-group">
              <kbd>N</kbd> new game
            </span>
            <span className="help-group">
              <kbd>right-click</kbd> flag
            </span>
            <span className="help-group">
              <kbd>middle-click</kbd> chord
            </span>
          </div>
        </div>

        <aside className="side-col">
          <Chat engine={engine} onAutoPlayChange={setAutoPlaying} />
          <ActionLog state={state} />
        </aside>
      </div>
    </div>
  );
}
