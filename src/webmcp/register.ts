import type { MinesweeperEngine } from "../game/engine";
import { minesweeperTools } from "./tools";

export interface WebMcpHandle {
  available: boolean;
  dispose(): void;
  toolNames: string[];
}

export function registerWebMcpTools(engine: MinesweeperEngine): WebMcpHandle {
  if (typeof navigator === "undefined" || !navigator.modelContext) {
    return { available: false, dispose() {}, toolNames: [] };
  }

  const modelContext = navigator.modelContext;
  const controller = new AbortController();
  const tools = minesweeperTools(engine);

  for (const tool of tools) {
    modelContext.registerTool(tool, { signal: controller.signal });
  }

  const toolNames = tools.map((t) => t.name);

  return {
    available: true,
    toolNames,
    dispose() {
      for (const name of [...toolNames].reverse()) {
        try {
          modelContext.unregisterTool?.(name);
        } catch {
          // ignore stale cleanup
        }
      }
      controller.abort();
    },
  };
}
