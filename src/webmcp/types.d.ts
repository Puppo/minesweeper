// Minimal ambient typings for the WebMCP preview surface.
// The `modelContext` getter moved from `Navigator` to `Document` per the WebML CG
// decision (Issue 173 / PR #184). `navigator.modelContext` is deprecated as of
// Chrome 150.0.7861.0 and will be removed in a future Chrome release — use
// `document.modelContext` instead. The Navigator augmentation is kept here
// temporarily so feature detection (`document.modelContext || navigator.modelContext`)
// keeps working until the legacy surface ships out.
// `unregisterTool` is gone from Chrome 148+, so it is optional here and we use
// `AbortSignal` for lifecycle.

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

interface Document {
  modelContext?: ModelContext;
}

interface Navigator {
  modelContext?: ModelContext;
}
