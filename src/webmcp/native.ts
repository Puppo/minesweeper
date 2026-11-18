/**
 * Records whether the browser exposed WebMCP natively at page load.
 *
 * `main.tsx` imports this module BEFORE `@w3c/webmcp-polyfill/auto`, so the
 * check runs before the polyfill installs `document.modelContext` and the
 * polyfill is never mistaken for native support.
 */
export const webMcpNativeAtLoad: boolean =
  typeof document !== "undefined" && "modelContext" in document;
