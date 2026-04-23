import { useEffect } from "react";
import type { MinesweeperEngine } from "../game/engine";

export function useKeyboard(engine: MinesweeperEngine) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      const state = engine.getState();
      const { cursor, config, status } = state;
      const gameOver = status === "won" || status === "lost";

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          engine.moveCursor(cursor.row - 1, cursor.col);
          break;
        case "ArrowDown":
          e.preventDefault();
          engine.moveCursor(cursor.row + 1, cursor.col);
          break;
        case "ArrowLeft":
          e.preventDefault();
          engine.moveCursor(cursor.row, cursor.col - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          engine.moveCursor(cursor.row, cursor.col + 1);
          break;
        case "Home":
          e.preventDefault();
          engine.moveCursor(cursor.row, 0);
          break;
        case "End":
          e.preventDefault();
          engine.moveCursor(cursor.row, config.cols - 1);
          break;
        case "PageUp":
          e.preventDefault();
          engine.moveCursor(0, cursor.col);
          break;
        case "PageDown":
          e.preventDefault();
          engine.moveCursor(config.rows - 1, cursor.col);
          break;
        case " ":
        case "Enter":
          e.preventDefault();
          if (!gameOver) engine.reveal(cursor.row, cursor.col, "human");
          break;
        case "f":
        case "F":
          e.preventDefault();
          if (!gameOver) engine.toggleFlag(cursor.row, cursor.col, "human");
          break;
        case "c":
        case "C":
          e.preventDefault();
          if (!gameOver) engine.chord(cursor.row, cursor.col, "human");
          break;
        case "n":
        case "N":
          e.preventDefault();
          engine.newGame({ difficulty: state.config.difficulty }, "human");
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engine]);
}
