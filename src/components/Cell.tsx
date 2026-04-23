import { memo } from "react";

interface CellProps {
  row: number;
  col: number;
  revealed: boolean;
  flagged: boolean;
  detonated: boolean;
  isMine: boolean;
  adjacentMines: number;
  isCursor: boolean;
  gameOver: boolean;
  flagMode: boolean;
  onReveal: (row: number, col: number) => void;
  onFlag: (row: number, col: number) => void;
  onChord: (row: number, col: number) => void;
  onHover: (row: number, col: number) => void;
}

function CellBase({
  row,
  col,
  revealed,
  flagged,
  detonated,
  isMine,
  adjacentMines,
  isCursor,
  gameOver,
  flagMode,
  onReveal,
  onFlag,
  onChord,
  onHover,
}: CellProps) {
  const classes = ["cell"];
  if (isCursor) classes.push("cursor");
  if (flagged && !revealed) classes.push("flagged");
  if (revealed) classes.push("revealed");
  if (revealed && isMine) classes.push("mine");
  if (detonated) classes.push("detonated");
  if (revealed && !isMine && adjacentMines === 0) classes.push("empty");
  if (revealed && !isMine && adjacentMines > 0) {
    classes.push(`num-${adjacentMines}`);
  }
  if (flagMode && !revealed) classes.push("flag-target");

  const disabled = gameOver && !revealed;

  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled}
      aria-label={`Cell row ${row} col ${col}`}
      onMouseEnter={() => onHover(row, col)}
      onClick={(e) => {
        e.preventDefault();
        if (flagMode && !revealed) {
          onFlag(row, col);
        } else {
          onReveal(row, col);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onFlag(row, col);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onChord(row, col);
        }
      }}
    >
      {revealed && !isMine && adjacentMines > 0 ? adjacentMines : null}
    </button>
  );
}

export const Cell = memo(CellBase);
