/**
 * Shared 8-neighbour offsets used by the engine and the solver.
 * Kept in one place so both stay aligned if the rule ever changes.
 */
export const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];
