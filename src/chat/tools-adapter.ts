import { READ_ONLY_TOOL_NAMES } from "../webmcp/tools";

export interface ToolCallEvents {
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  onToolEnd?: (
    name: string,
    input: Record<string, unknown>,
    result: unknown,
  ) => void;
  onToolError?: (
    name: string,
    input: Record<string, unknown>,
    error: unknown,
  ) => void;
}

export interface AdaptToolsOptions {
  events?: ToolCallEvents;
  /** If provided, only tools where filter returns true are exposed. */
  filter?: (tool: ModelContextTool) => boolean;
  /** Sleep this many ms after a *mutating* tool returns (paces auto-play). */
  paceMs?: number;
  /** Abort cooperative pacing + reject before further calls. */
  signal?: AbortSignal;
}

const NOOP_CLIENT: ModelContextClient = {
  requestUserInteraction: (cb) => Promise.resolve(cb()),
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);
  });
}

/**
 * Bridge WebMCP tool definitions into the shape expected by
 * `LanguageModel.create({ tools })`. The adapter:
 *  - JSON.stringifies each result (Prompt API requires a string return),
 *  - forwards before/after events so the chat UI can render each move,
 *  - optionally paces mutating calls so users can watch the board update.
 */
export function mcpToolsAsLanguageModelTools(
  tools: ModelContextTool[],
  opts: AdaptToolsOptions = {},
): LanguageModelTool[] {
  const filtered = opts.filter ? tools.filter(opts.filter) : tools;

  return filtered.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema:
      tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: false },
    async execute(input: Record<string, unknown> = {}) {
      if (opts.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      opts.events?.onToolStart?.(tool.name, input);
      try {
        const result = await tool.execute(input, NOOP_CLIENT);
        opts.events?.onToolEnd?.(tool.name, input, result);

        if (
          opts.paceMs &&
          opts.paceMs > 0 &&
          !READ_ONLY_TOOL_NAMES.has(tool.name)
        ) {
          await sleep(opts.paceMs, opts.signal);
        }

        return JSON.stringify(result);
      } catch (err) {
        opts.events?.onToolError?.(tool.name, input, err);
        const message = err instanceof Error ? err.message : String(err);
        // Returning the error as a tool result lets the model recover gracefully
        // instead of aborting the whole prompt. AbortError still propagates.
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        return JSON.stringify({ ok: false, error: message });
      }
    },
  }));
}
