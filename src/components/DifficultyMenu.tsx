import type { Difficulty } from "../game/types";

interface DifficultyMenuProps {
  current: Difficulty;
  onSelect: (difficulty: Difficulty) => void;
}

const OPTIONS: Array<{ id: Difficulty; label: string; sub: string; icon: string }> = [
  { id: "beginner", label: "Beginner", sub: "9×9 · 10", icon: "◆" },
  { id: "intermediate", label: "Intermediate", sub: "16×16 · 40", icon: "◆◆" },
  { id: "expert", label: "Expert", sub: "16×30 · 99", icon: "◆◆◆" },
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
          aria-pressed={current === opt.id}
        >
          <span className="btn-ic" aria-hidden>{opt.icon}</span>
          {opt.label}
          <span className="btn-sub">{opt.sub}</span>
        </button>
      ))}
    </div>
  );
}
