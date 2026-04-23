import { useEffect, useState } from "react";
import type { GameState } from "../game/types";

interface HudProps {
  state: GameState;
  onReset: () => void;
  flagMode: boolean;
  onToggleFlagMode: () => void;
  bestTimeSeconds: number | null;
}

function pad(n: number, width = 3): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.min(Math.max(n, -99), 999));
  return sign + String(abs).padStart(width, "0");
}

export function Hud({
  state,
  onReset,
  flagMode,
  onToggleFlagMode,
  bestTimeSeconds,
}: HudProps) {
  const { config, flagsPlaced, cellsRevealed, status, startedAt, endedAt } = state;
  const minesRemaining = config.mines - flagsPlaced;
  const totalSafe = config.rows * config.cols - config.mines;
  const progress = totalSafe > 0 ? Math.min(100, (cellsRevealed / totalSafe) * 100) : 0;
  const [, setNow] = useState(0);

  useEffect(() => {
    if (status !== "playing") return;
    const interval = window.setInterval(() => setNow((n) => n + 1), 250);
    return () => window.clearInterval(interval);
  }, [status]);

  const elapsedMs = startedAt ? (endedAt ?? Date.now()) - startedAt : 0;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  const face =
    status === "lost" ? "💀" :
    status === "won" ? "😎" :
    status === "playing" ? "🙂" :
    "🎮";

  return (
    <div className="panel hud">
      <div className="hud-item">
        <span className="hud-label">Mines</span>
        <span className="lcd">{pad(minesRemaining)}</span>
      </div>

      <button
        type="button"
        className={`status-face ${status}`}
        onClick={onReset}
        title="Restart"
        aria-label="Restart game"
      >
        {face}
      </button>

      <div className="hud-progress">
        <div className="hud-progress-meta">
          <span>{Math.round(progress)}% cleared</span>
          {bestTimeSeconds != null && (
            <span className="best" title={`Best time on ${config.difficulty}`}>
              ★ best {pad(bestTimeSeconds)}
            </span>
          )}
        </div>
        <div className="hud-progress-bar">
          <div
            className="hud-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="hud-item">
        <span className="hud-label">Time</span>
        <span className="lcd timer">{pad(elapsedSeconds)}</span>
      </div>

      <button
        type="button"
        className={`flag-toggle ${flagMode ? "active" : ""}`}
        onClick={onToggleFlagMode}
        title="Toggle flag mode — when on, tapping a cell places a flag"
        aria-pressed={flagMode}
      >
        <span className="flag-icon">⚑</span>
        <span>{flagMode ? "Flag mode" : "Reveal mode"}</span>
      </button>
    </div>
  );
}
