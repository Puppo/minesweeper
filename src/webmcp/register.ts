import type { MinesweeperEngine } from "../game/engine";
import { minesweeperTools } from "./tools";

export interface WebMcpHandle {
  available: boolean;
  dispose(): void;
  toolNames: string[];
}

// `document.modelContext` comes from the browser where WebMCP ships natively,
// or from `@w3c/webmcp-polyfill` (imported in `main.tsx`) everywhere else. So in
// any secure context it is always set by the time this runs; the `undefined`
// path is only hit in non-secure contexts (plain HTTP). The legacy
// `navigator.modelContext` surface (deprecated since Chrome 150, removed later)
// needs no fallback: the polyfill installs on `Document` there too.
function resolveModelContext(): WebMCP.ModelContext | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document.modelContext;
}

export function registerWebMcpTools(engine: MinesweeperEngine): WebMcpHandle {
  const modelContext = resolveModelContext();
  if (!modelContext) {
    return { available: false, dispose() {}, toolNames: [] };
  }

  const controller = new AbortController();
  const tools = minesweeperTools(engine);
  const toolNames = tools.map((t) => t.name);

  for (const tool of tools) {
    // The polyfill's `registerTool` returns a promise (native Chrome's returns
    // void). Swallow rejections caused by our own abort — React StrictMode's
    // double-mount aborts the first mount's registrations mid-flight — but
    // surface genuine registration failures.
    void Promise.resolve(
      modelContext.registerTool(tool, { signal: controller.signal }),
    ).catch((err: unknown) => {
      if (!controller.signal.aborted) {
        console.warn(
          `[minesweeper] failed to register WebMCP tool "${tool.name}"`,
          err,
        );
      }
    });
  }

  return {
    available: true,
    toolNames,
    dispose() {
      // `unregisterTool` is gone from Chrome 148+ and absent from the polyfill;
      // the AbortSignal is the only lifecycle mechanism.
      controller.abort();
    },
  };
}
