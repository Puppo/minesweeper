import { useCallback, useEffect, useState } from "react";
import { Board } from "./components/Board";
import { DifficultyMenu } from "./components/DifficultyMenu";
import { Hud } from "./components/Hud";
import { ActionLog } from "./components/ActionLog";
import { useEngine } from "./hooks/useEngine";
import { useKeyboard } from "./hooks/useKeyboard";
import { registerWebMcpTools } from "./webmcp/register";
import type { Difficulty } from "./game/types";

export default function App() {
  const { engine } = useEngine();
  const state = engine.getState();
  const [mcpAvailable, setMcpAvailable] = useState(false);
  const [toolCount, setToolCount] = useState(0);

  useKeyboard(engine);

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
    },
    [engine],
  );

  const onReset = useCallback(() => {
    engine.newGame({ difficulty: state.config.difficulty }, "human");
  }, [engine, state.config.difficulty]);

  return (
    <div className="app">
      <div className={`mcp-badge ${mcpAvailable ? "" : "off"}`} title={
        mcpAvailable
          ? `${toolCount} WebMCP tools registered`
          : "WebMCP not available in this browser (Chrome 146+ with chrome://flags/#enable-webmcp-testing)"
      }>
        <span className="mcp-dot" />
        {mcpAvailable ? `WebMCP · ${toolCount} tools` : "WebMCP offline"}
      </div>

      <header className="header">
        <h1 className="title">MINESWEEPER</h1>
        <p className="subtitle">WebMCP edition · play with mouse, keyboard, or let an LLM drive</p>
      </header>

      <DifficultyMenu current={state.config.difficulty} onSelect={onSelectDifficulty} />
      <Hud state={state} onReset={onReset} />
      <Board
        state={state}
        onReveal={onReveal}
        onFlag={onFlag}
        onChord={onChord}
        onHover={onHover}
        onNewGame={onReset}
      />
      <ActionLog state={state} />

      <div className="help">
        <span><kbd>←↑↓→</kbd> move cursor</span>
        <span><kbd>Space</kbd>/<kbd>↵</kbd> reveal</span>
        <span><kbd>F</kbd> flag</span>
        <span><kbd>C</kbd> chord</span>
        <span><kbd>N</kbd> new game</span>
        <span><kbd>right-click</kbd> flag</span>
        <span><kbd>middle-click</kbd> chord</span>
      </div>
    </div>
  );
}
