import { useEffect, useRef, useState } from "react";
import type { ActionLog as Entry, GameState } from "../game/types";

interface ActionLogProps {
  state: GameState;
}

const MAX_ENTRIES = 8;

export function ActionLog({ state }: ActionLogProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const lastTimestamp = useRef<number>(0);

  useEffect(() => {
    const action = state.lastAction;
    if (!action) return;
    if (action.timestamp === lastTimestamp.current) return;
    lastTimestamp.current = action.timestamp;
    setEntries((prev) => [action, ...prev].slice(0, MAX_ENTRIES));
  }, [state.lastAction]);

  return (
    <div className="panel log">
      <div className="log-title">Action log</div>
      <div className="log-entries">
        {entries.length === 0 ? (
          <div className="log-entry" style={{ opacity: 0.6 }}>
            <span className="msg">
              No moves yet. Click a cell — or let the AI play via WebMCP.
            </span>
          </div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={entry.timestamp + "-" + i}
              className={`log-entry ${entry.kind}`}
            >
              <span className={`source ${entry.source}`}>{entry.source}</span>
              <span className="time">{formatTime(entry.timestamp)}</span>
              <span className="msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}
