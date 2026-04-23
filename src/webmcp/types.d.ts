// Minimal ambient typings for the WebMCP preview surface (navigator.modelContext).
// Based on Chrome 146+ early preview. `unregisterTool` is gone from Chrome 148+,
// so it is optional here and we use `AbortSignal` for lifecycle.

interface ModelContextClient {
  requestUserInteraction(callback: () => Promise<unknown>): Promise<unknown>;
}

interface ModelContextToolAnnotations {
  readOnlyHint?: boolean;
}

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ModelContextToolAnnotations;
  execute(
    input: Record<string, unknown>,
    client: ModelContextClient,
  ): Promise<unknown> | unknown;
}

interface ModelContextRegisterOptions {
  signal?: AbortSignal;
}

interface ModelContext {
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterOptions): void;
  unregisterTool?(name: string): void;
}

interface Navigator {
  modelContext?: ModelContext;
}
