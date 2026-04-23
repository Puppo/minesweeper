import type { Difficulty } from "../game/types";

interface DifficultyMenuProps {
  current: Difficulty;
  onSelect: (difficulty: Difficulty) => void;
}

const OPTIONS: Array<{ id: Difficulty; label: string; sub: string }> = [
  { id: "beginner", label: "Beginner", sub: "9×9 · 10" },
  { id: "intermediate", label: "Intermediate", sub: "16×16 · 40" },
  { id: "expert", label: "Expert", sub: "16×30 · 99" },
];

export function DifficultyMenu({ current, onSelect }: DifficultyMenuProps) {
  return (
    <div className="panel menu">
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`menu-btn ${current === opt.id ? "active" : ""}`}
          onClick={() => onSelect(opt.id)}
        >
          {opt.label}
          <span style={{ opacity: 0.55, marginLeft: 8, fontSize: 10 }}>{opt.sub}</span>
        </button>
      ))}
    </div>
  );
}
