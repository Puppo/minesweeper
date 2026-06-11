import type { MinesweeperEngine } from "../game/engine";
import { minesweeperTools } from "./tools";

export interface WebMcpHandle {
  available: boolean;
  dispose(): void;
  toolNames: string[];
}

// The `modelContext` getter moved from `Navigator` to `Document` per the WebML CG
// decision (Issue 173 / PR #184). We prefer `document.modelContext` and fall back
// to `navigator.modelContext` for older Chrome builds during the transition.
function resolveModelContext(): ModelContext | undefined {
  if (typeof document !== "undefined" && document.modelContext) {
    return document.modelContext;
  }
  if (typeof navigator !== "undefined" && navigator.modelContext) {
    return navigator.modelContext;
  }
  return undefined;
}

export function registerWebMcpTools(engine: MinesweeperEngine): WebMcpHandle {
  const modelContext = resolveModelContext();
  if (!modelContext) {
    return { available: false, dispose() {}, toolNames: [] };
  }

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
