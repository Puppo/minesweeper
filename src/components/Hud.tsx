import { useEffect, useState } from "react";
import type { GameState } from "../game/types";

interface HudProps {
  state: GameState;
  onReset: () => void;
}

function pad(n: number, width = 3): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.min(Math.max(n, -99), 999));
  return sign + String(abs).padStart(width, "0");
}

export function Hud({ state, onReset }: HudProps) {
  const { config, flagsPlaced, status, startedAt, endedAt } = state;
  const minesRemaining = config.mines - flagsPlaced;
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
      <div className="hud-divider" />
      <button
        type="button"
        className={`status-face ${status}`}
        onClick={onReset}
        title="Restart"
        aria-label="Restart game"
      >
        {face}
      </button>
      <div className="hud-divider" />
      <div className="hud-item">
        <span className="hud-label">Time</span>
        <span className="lcd timer">{pad(elapsedSeconds)}</span>
      </div>
    </div>
  );
}
