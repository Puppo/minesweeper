import { NEIGHBOR_OFFSETS } from "./geometry";
import type { PublicBoardView } from "./types";

export type DeterministicMoveKind = "reveal" | "flag" | "chord";

export interface DeterministicMove {
  kind: DeterministicMoveKind;
  row: number;
  col: number;
  reason: string;
}

/**
 * Constraint imposed by a revealed number on the board.
 *
 * - `value` is the original adjacency count (1-8).
 * - `hidden` lists hidden neighbour cells encoded as `row * cols + col`.
 * - `minesLeft = value - flaggedNeighbours`, i.e. the number of mines that must
 *   still be hidden among `hidden` for the constraint to be satisfied.
 *
 * Public so other modules (LLM prompt builder, future UI overlays) can reuse
 * the same data structure the solver uses for deduction.
 */
export interface NumberConstraint {
  row: number;
  col: number;
  value: number;
  hidden: number[];
  minesLeft: number;
}

/**
 * Walk the board and build one `NumberConstraint` per revealed number that
 * still has hidden neighbours. Numbers whose neighbours are fully resolved
 * (all revealed/flagged) are dropped — they no longer constrain anything.
 */
export function buildConstraints(view: PublicBoardView): NumberConstraint[] {
  const { rows, cols, cells } = view;
  const out: NumberConstraint[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      if (cell.state !== "revealed-number") continue;
      const N = cell.adjacentMines ?? 0;
      const hidden: number[] = [];
      let flagged = 0;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const n = cells[nr][nc];
        if (n.state === "hidden") hidden.push(nr * cols + nc);
        else if (n.state === "flagged") flagged++;
      }
      if (hidden.length === 0) continue;
      out.push({ row: r, col: c, value: N, hidden, minesLeft: N - flagged });
    }
  }
  return out;
}

function flagsAround(constraint: NumberConstraint): number {
  return constraint.value - constraint.minesLeft;
}

/**
 * Render the per-number constraint summary that the LLM consumes in auto/help
 * modes. One row per revealed number cell that still has hidden neighbours:
 *
 *   (r,c)=N · flags: K · hidden: (..),(..) · needs M more mine(s)
 *
 * Returns a multi-line string, or a one-line "(none)" notice when there are no
 * active constraints (e.g. opening move). The string is purely informational —
 * no answer tagging, the model still has to apply the rules.
 */
export function formatConstraintDigest(view: PublicBoardView): string {
  const constraints = buildConstraints(view);
  if (constraints.length === 0) {
    return "Constraint digest: (none — no revealed numbers have hidden neighbours yet).";
  }
  const lines = constraints.map((ct) => {
    const coords = ct.hidden
      .map((idx) => `(${Math.floor(idx / view.cols)},${idx % view.cols})`)
      .join(",");
    const need = `needs ${ct.minesLeft} more mine${ct.minesLeft === 1 ? "" : "s"}`;
    return `  (${ct.row},${ct.col})=${ct.value} · flags: ${flagsAround(ct)} · hidden: ${coords} · ${need}`;
  });
  return [
    "Constraint digest (one row per revealed number with hidden neighbours):",
    ...lines,
  ].join("\n");
}

function isSubset(a: number[], bSet: Set<number>): boolean {
  for (const idx of a) if (!bSet.has(idx)) return false;
  return true;
}

function indexToMove(
  idx: number,
  cols: number,
  kind: DeterministicMoveKind,
  reason: string,
): DeterministicMove {
  return { kind, row: Math.floor(idx / cols), col: idx % cols, reason };
}

function findTrivial(
  constraints: NumberConstraint[],
  cols: number,
): DeterministicMove | null {
  // Prefer flags first — they unlock further deductions on the next turn.
  for (const ct of constraints) {
    if (ct.minesLeft === ct.hidden.length && ct.minesLeft > 0) {
      const reason =
        `Number ${ct.value} at (${ct.row}, ${ct.col}) has exactly ${ct.hidden.length} ` +
        `hidden neighbour${ct.hidden.length === 1 ? "" : "s"} still needing ${ct.minesLeft} ` +
        `mine${ct.minesLeft === 1 ? "" : "s"} — every hidden neighbour must be a mine.`;
      return indexToMove(ct.hidden[0], cols, "flag", reason);
    }
  }
  for (const ct of constraints) {
    if (ct.minesLeft === 0) {
      const reason =
        `Number ${ct.value} at (${ct.row}, ${ct.col}) already has all its mines flagged — ` +
        `chord reveals all ${ct.hidden.length} safe neighbour${ct.hidden.length === 1 ? "" : "s"} at once.`;
      return { kind: "chord", row: ct.row, col: ct.col, reason };
    }
  }
  return null;
}

function findSubset(
  constraints: NumberConstraint[],
  cols: number,
): DeterministicMove | null {
  const sets = constraints.map((c) => new Set(c.hidden));
  for (let i = 0; i < constraints.length; i++) {
    const A = constraints[i];
    const aSet = sets[i];
    for (let j = 0; j < constraints.length; j++) {
      if (i === j) continue;
      const B = constraints[j];
      if (A.hidden.length >= B.hidden.length) continue;
      const bSet = sets[j];
      if (!isSubset(A.hidden, bSet)) continue;

      const diffMines = B.minesLeft - A.minesLeft;
      const diff: number[] = [];
      for (const idx of B.hidden) if (!aSet.has(idx)) diff.push(idx);

      if (diffMines === 0 && diff.length > 0) {
        const reason =
          `(${A.row}, ${A.col}) accounts for all mines shared with (${B.row}, ${B.col}); ` +
          `the remaining ${diff.length} hidden neighbour${diff.length === 1 ? " is" : "s are"} safe.`;
        return indexToMove(diff[0], cols, "reveal", reason);
      }
      if (diffMines > 0 && diffMines === diff.length) {
        const reason =
          `(${B.row}, ${B.col}) needs ${B.minesLeft} mine${B.minesLeft === 1 ? "" : "s"} but ` +
          `(${A.row}, ${A.col}) already covers ${A.minesLeft}; the remaining ${diff.length} ` +
          `cell${diff.length === 1 ? " is" : "s are"} all mines.`;
        return indexToMove(diff[0], cols, "flag", reason);
      }
    }
  }
  return null;
}

/**
 * Find one provably-forced move on the current board, or null if none exists.
 *
 * Tiers, applied in order:
 *   1. Opening: with nothing revealed, click the centre — the engine guarantees
 *      the first click and its 8 neighbours are mine-free.
 *   2. Trivial deduction: a revealed number whose hidden neighbours are all
 *      forced mines (count rule), or whose flags already satisfy it (forced-safe).
 *   3. Subset deduction: when one constraint's hidden set is a strict subset of
 *      another's, the difference is fully determined — used to crack 1-1 / 1-2-1
 *      patterns the trivial rule misses.
 *
 * Never guesses. If no forced move exists, returns null and the caller falls through to
 * probabilistic guessing or pauses.
 */
export function findDeterministicMove(
  view: PublicBoardView,
): DeterministicMove | null {
  if (view.cellsRevealed === 0 && view.flagsPlaced === 0) {
    const row = Math.floor(view.rows / 2);
    const col = Math.floor(view.cols / 2);
    return {
      kind: "reveal",
      row,
      col,
      reason: `Opening reveal at the centre (${row}, ${col}) — the first click and its neighbourhood are guaranteed mine-free.`,
    };
  }

  // Global constraint: compare total hidden cells against remaining mines.
  let totalHidden = 0;
  for (let r = 0; r < view.rows; r++) {
    for (let c = 0; c < view.cols; c++) {
      if (view.cells[r][c].state === "hidden") totalHidden++;
    }
  }
  if (view.minesRemaining > 0 && view.minesRemaining === totalHidden) {
    // Every hidden cell must be a mine.
    for (let r = 0; r < view.rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        if (view.cells[r][c].state === "hidden") {
          return {
            kind: "flag",
            row: r,
            col: c,
            reason:
              `Global constraint: ${totalHidden} hidden cell${totalHidden === 1 ? "" : "s"} remain ` +
              `and exactly ${view.minesRemaining} mine${view.minesRemaining === 1 ? "" : "s"} are unplaced — ` +
              `every hidden cell is a mine.`,
          };
        }
      }
    }
  }
  if (view.minesRemaining === 0) {
    // All mines are flagged — every hidden cell is safe.
    for (let r = 0; r < view.rows; r++) {
      for (let c = 0; c < view.cols; c++) {
        if (view.cells[r][c].state === "hidden") {
          return {
            kind: "reveal",
            row: r,
            col: c,
            reason: `Global constraint: all ${view.mines} mines are flagged — every remaining hidden cell is safe.`,
          };
        }
      }
    }
  }

  const constraints = buildConstraints(view);
  return (
    findTrivial(constraints, view.cols) ?? findSubset(constraints, view.cols)
  );
}

/**
 * Estimate the mine probability for every hidden cell.
 *
 * Strategy:
 *   1. Start each hidden cell at the global uniform estimate:
 *      minesRemaining / totalHidden.
 *   2. For every constraint C = (hidden[], minesLeft), compute the local
 *      probability minesLeft / hidden.length and take the MAX with the
 *      current estimate for each cell in C.hidden (conservative: a cell
 *      appearing in a high-density constraint is treated as more dangerous).
 *
 * Returns a Map from encoded index (row * cols + col) to probability in [0,1].
 */
export function estimateMineProbabilities(
  view: PublicBoardView,
  constraints: NumberConstraint[],
): Map<number, number> {
  const { rows, cols, minesRemaining } = view;

  let totalHidden = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (view.cells[r][c].state === "hidden") totalHidden++;
    }
  }

  const defaultProb = totalHidden > 0 ? minesRemaining / totalHidden : 0;

  const probs = new Map<number, number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (view.cells[r][c].state === "hidden") {
        probs.set(r * cols + c, defaultProb);
      }
    }
  }

  for (const ct of constraints) {
    if (ct.hidden.length === 0) continue;
    const ctProb = ct.minesLeft / ct.hidden.length;
    for (const idx of ct.hidden) {
      const current = probs.get(idx) ?? defaultProb;
      probs.set(idx, Math.max(current, ctProb));
    }
  }

  return probs;
}

/**
 * When no deterministic move is available, return the hidden cell with the
 * lowest estimated mine probability as a probabilistic best guess (reveal).
 *
 * Returns null if there are no hidden cells.
 */
export function findBestGuess(view: PublicBoardView): DeterministicMove | null {
  const constraints = buildConstraints(view);
  const probs = estimateMineProbabilities(view, constraints);

  let bestIdx = -1;
  let bestProb = Infinity;
  for (const [idx, prob] of probs) {
    if (prob < bestProb) {
      bestProb = prob;
      bestIdx = idx;
    }
  }

  if (bestIdx === -1) return null;

  const row = Math.floor(bestIdx / view.cols);
  const col = bestIdx % view.cols;
  return {
    kind: "reveal",
    row,
    col,
    reason: `Best probabilistic guess: (${row},${col}) has ~${(bestProb * 100).toFixed(1)}% mine probability.`,
  };
}
