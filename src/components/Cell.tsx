import { memo } from "react";
import type { CellState } from "../game/types";

interface CellProps {
  cell: CellState;
  isCursor: boolean;
  gameOver: boolean;
  onReveal: (row: number, col: number) => void;
  onFlag: (row: number, col: number) => void;
  onChord: (row: number, col: number) => void;
  onHover: (row: number, col: number) => void;
}

function CellBase({ cell, isCursor, gameOver, onReveal, onFlag, onChord, onHover }: CellProps) {
  const classes = ["cell"];
  if (isCursor) classes.push("cursor");
  if (cell.flagged && !cell.revealed) classes.push("flagged");
  if (cell.revealed) classes.push("revealed");
  if (cell.revealed && cell.isMine) classes.push("mine");
  if (cell.detonated) classes.push("detonated");
  if (cell.revealed && !cell.isMine && cell.adjacentMines === 0) classes.push("empty");
  if (cell.revealed && !cell.isMine && cell.adjacentMines > 0) {
    classes.push(`num-${cell.adjacentMines}`);
  }

  const disabled = gameOver && !cell.revealed;

  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled}
      aria-label={`Cell row ${cell.row} col ${cell.col}`}
      onMouseEnter={() => onHover(cell.row, cell.col)}
      onClick={(e) => {
        e.preventDefault();
        onReveal(cell.row, cell.col);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onFlag(cell.row, cell.col);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onChord(cell.row, cell.col);
        }
      }}
    >
      {cell.revealed && !cell.isMine && cell.adjacentMines > 0 ? cell.adjacentMines : null}
    </button>
  );
}

export const Cell = memo(CellBase);
