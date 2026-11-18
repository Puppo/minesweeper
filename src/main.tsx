// Import order matters: the native-support probe must run before the polyfill
// installs `document.modelContext`, and the polyfill must run before React
// renders so tools can register in browsers without native WebMCP.
import "./webmcp/native";
import "@w3c/webmcp-polyfill/auto";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
