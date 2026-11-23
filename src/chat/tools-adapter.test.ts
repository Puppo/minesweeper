import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpToolsAsLanguageModelTools } from "./tools-adapter";

function makeTool(name: string, readOnly: boolean): WebMCP.ModelContextTool {
  return {
    name,
    description: name,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly ? { readOnlyHint: true } : undefined,
    execute: () => ({ ok: true }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mcpToolsAsLanguageModelTools", () => {
  it("paces mutating tools but not annotation-marked read-only tools", async () => {
    vi.useFakeTimers();
    const [readOnly, mutating] = mcpToolsAsLanguageModelTools(
      [makeTool("read", true), makeTool("write", false)],
      { paceMs: 100 },
    );

    await expect(readOnly.execute({})).resolves.toBe('{"ok":true}');

    let settled = false;
    const pending = mutating.execute({}).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe('{"ok":true}');
  });
});
