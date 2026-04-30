import { useMemo } from "react";
import type { GameState } from "../game/types";
import { Cell } from "./Cell";

interface BoardProps {
  state: GameState;
  flagMode: boolean;
  bestTimeSeconds: number | null;
  isNewBest: boolean;
  interactive?: boolean;
  onReveal: (row: number, col: number) => void;
  onFlag: (row: number, col: number) => void;
  onChord: (row: number, col: number) => void;
  onHover: (row: number, col: number) => void;
  onNewGame: () => void;
}

function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function Board({
  state,
  flagMode,
  bestTimeSeconds,
  isNewBest,
  interactive = true,
  onReveal,
  onFlag,
  onChord,
  onHover,
  onNewGame,
}: BoardProps) {
  const { config, cells, cursor, status, startedAt, endedAt } = state;
  const gameOver = status === "won" || status === "lost";
  const elapsedSeconds =
    startedAt ? Math.floor(((endedAt ?? Date.now()) - startedAt) / 1000) : 0;

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${config.cols}, var(--cell-size))`,
      gridTemplateRows: `repeat(${config.rows}, var(--cell-size))`,
    }),
    [config.cols, config.rows],
  );

  const wrapClasses = [
    "panel",
    "board-wrap",
    flagMode ? "flag-mode" : "",
    !interactive ? "non-interactive" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClasses}>
      {!interactive && (
        <div className="board-lock-banner" aria-live="polite">
          AI is playing — board input disabled
        </div>
      )}
      <div className="board" style={gridStyle}>
        {cells.map((row, r) =>
          row.map((cell, c) => (
            <Cell
              key={`${r}-${c}`}
              row={cell.row}
              col={cell.col}
              revealed={cell.revealed}
              flagged={cell.flagged}
              detonated={cell.detonated}
              isMine={cell.isMine}
              adjacentMines={cell.adjacentMines}
              isCursor={cursor.row === r && cursor.col === c}
              gameOver={gameOver}
              flagMode={flagMode}
              onReveal={onReveal}
              onFlag={onFlag}
              onChord={onChord}
              onHover={onHover}
            />
          )),
        )}
      </div>
      {gameOver ? (
        <div className="overlay">
          <div className={`overlay-card ${status}`}>
            <h2 className={`overlay-title ${status}`}>
              {status === "won" ? "VICTORY" : "GAME OVER"}
            </h2>
            <p className="overlay-body">
              {status === "won"
                ? isNewBest
                  ? "New personal best! You swept the field in record time."
                  : "You cleared the field without a single wrong step."
                : "One wrong tile, one big bang. Try again?"}
            </p>
            {status === "won" && (
              <div className="overlay-stats">
                <div>
                  Time
                  <strong>{formatSeconds(elapsedSeconds)}</strong>
                </div>
                {bestTimeSeconds != null && (
                  <div>
                    Best
                    <strong className="best">{formatSeconds(bestTimeSeconds)}</strong>
                  </div>
                )}
              </div>
            )}
            <button type="button" className="menu-btn primary" onClick={onNewGame}>
              New game
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
