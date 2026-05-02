import { useState } from "react";
import type { Difficulty } from "../game/types";

interface DifficultyMenuProps {
  current: Difficulty;
  onSelect: (difficulty: Difficulty) => void;
  onCustomSelect?: (rows: number, cols: number, mines: number) => void;
}

const OPTIONS: Array<{ id: Difficulty; label: string; sub: string; icon: string }> = [
  { id: "beginner", label: "Beginner", sub: "9×9 · 10", icon: "◆" },
  { id: "intermediate", label: "Intermediate", sub: "16×16 · 40", icon: "◆◆" },
  { id: "expert", label: "Expert", sub: "16×30 · 99", icon: "◆◆◆" },
];

export function DifficultyMenu({ current, onSelect, onCustomSelect }: DifficultyMenuProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customRows, setCustomRows] = useState(16);
  const [customCols, setCustomCols] = useState(16);
  const [customMines, setCustomMines] = useState(40);

  const handleCustomSubmit = () => {
    if (onCustomSelect) {
      onCustomSelect(customRows, customCols, customMines);
      setShowCustom(false);
    }
  };

  const maxMines = customRows * customCols - 9;

  return (
    <div className="panel menu">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`menu-btn ${current === opt.id && !showCustom ? "active" : ""}`}
          onClick={() => {
            onSelect(opt.id);
            setShowCustom(false);
          }}
          aria-pressed={current === opt.id && !showCustom}
        >
          <span className="btn-ic" aria-hidden>{opt.icon}</span>
          {opt.label}
          <span className="btn-sub">{opt.sub}</span>
        </button>
      ))}
      <button
        type="button"
        className={`menu-btn ${showCustom ? "active" : ""}`}
        onClick={() => setShowCustom(!showCustom)}
        aria-pressed={showCustom}
      >
        <span className="btn-ic" aria-hidden>◇</span>
        Custom
        <span className="btn-sub">{customRows}×{customCols} · {customMines}</span>
      </button>
      {showCustom && (
        <div className="custom-inputs">
          <label>
            Rows
            <input
              type="number"
              min={5}
              max={30}
              value={customRows}
              onChange={(e) => setCustomRows(Math.max(5, Math.min(30, Number(e.target.value))))}
            />
          </label>
          <label>
            Cols
            <input
              type="number"
              min={5}
              max={40}
              value={customCols}
              onChange={(e) => setCustomCols(Math.max(5, Math.min(40, Number(e.target.value))))}
            />
          </label>
          <label>
            Mines
            <input
              type="number"
              min={1}
              max={maxMines}
              value={Math.min(customMines, maxMines)}
              onChange={(e) => setCustomMines(Math.max(1, Math.min(maxMines, Number(e.target.value))))}
            />
          </label>
          <button type="button" className="menu-btn" onClick={handleCustomSubmit}>
            Start Game
          </button>
        </div>
      )}
    </div>
  );
}
