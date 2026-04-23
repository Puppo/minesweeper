import { useMemo } from "react";
import type { GameState } from "../game/types";
import { Cell } from "./Cell";

interface BoardProps {
  state: GameState;
  onReveal: (row: number, col: number) => void;
  onFlag: (row: number, col: number) => void;
  onChord: (row: number, col: number) => void;
  onHover: (row: number, col: number) => void;
  onNewGame: () => void;
}

export function Board({ state, onReveal, onFlag, onChord, onHover, onNewGame }: BoardProps) {
  const { config, cells, cursor, status } = state;
  const gameOver = status === "won" || status === "lost";

  const gridStyle = useMemo(
    () => ({
      gridTemplateColumns: `repeat(${config.cols}, var(--cell-size))`,
      gridTemplateRows: `repeat(${config.rows}, var(--cell-size))`,
    }),
    [config.cols, config.rows],
  );

  return (
    <div className="panel board-wrap">
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
                ? "You cleared the field without a single wrong step."
                : "One wrong tile, one big bang. Try again?"}
            </p>
            <button type="button" className="menu-btn primary" onClick={onNewGame}>
              New game
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
