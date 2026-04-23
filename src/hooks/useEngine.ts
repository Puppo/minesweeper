import { useEffect, useMemo, useState } from "react";
import { MinesweeperEngine } from "../game/engine";

export function useEngine(): {
  engine: MinesweeperEngine;
  tick: number;
} {
  const engine = useMemo(() => new MinesweeperEngine({ difficulty: "beginner" }), []);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    return engine.subscribe(() => {
      setTick((t) => t + 1);
    });
  }, [engine]);

  return { engine, tick };
}
