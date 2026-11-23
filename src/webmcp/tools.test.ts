import { describe, expect, it } from "vitest";
import { MinesweeperEngine } from "../game/engine";
import { GAME_RULES, PLAY_STRATEGY } from "../game/guidance";
import { minesweeperTools } from "./tools";

// `WebMCP.ToolExecuteCallback` requires an options argument; the tools under
// test ignore it.
const execOptions: WebMCP.ToolExecuteCallbackOptions = {
  signal: new AbortController().signal,
};

function getTool(engine: MinesweeperEngine, name: string): WebMCP.ModelContextTool {
  const tool = minesweeperTools(engine).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe("minesweeperTools", () => {
  it("exposes the complete nine-tool surface", () => {
    const names = minesweeperTools(new MinesweeperEngine()).map((tool) => tool.name);
    expect(names).toEqual([
      "get_game_rules",
      "get_play_strategy",
      "analyze_board",
      "start_new_game",
      "reveal_cell",
      "toggle_flag",
      "chord_cell",
      "get_board_state",
      "get_game_status",
    ]);
  });

  it.each(["get_game_rules", "get_play_strategy", "analyze_board"])(
    "marks %s read-only and gives it a strict empty input schema",
    (name) => {
      const tool = getTool(new MinesweeperEngine(), name);
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        properties: {},
        additionalProperties: false,
      });
    },
  );

  it("returns the canonical rules and strategy", async () => {
    const engine = new MinesweeperEngine();
    await expect(
      Promise.resolve(getTool(engine, "get_game_rules").execute({}, execOptions)),
    ).resolves.toBe(GAME_RULES);
    await expect(
      Promise.resolve(
        getTool(engine, "get_play_strategy").execute({}, execOptions),
      ),
    ).resolves.toBe(PLAY_STRATEGY);
  });

  it("analyzes the board without mutating the engine", async () => {
    const engine = new MinesweeperEngine();
    const before = structuredClone(engine.getState());

    await expect(
      Promise.resolve(getTool(engine, "analyze_board").execute({}, execOptions)),
    ).resolves.toMatchObject({
      status: "idle",
      recommendation: {
        tool: "reveal_cell",
        input: { row: 4, col: 4 },
        certainty: "certain-safe",
      },
    });
    expect(engine.getState()).toEqual(before);
  });
});
