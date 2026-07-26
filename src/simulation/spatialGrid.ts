/**
 * Uniform spatial hash grid broadphase for agent-pair interactions.
 *
 * The physics and pressure passes only ever need pairs closer than a small
 * interaction cutoff (tens of px) while the floor spans hundreds of px, so
 * scanning all O(n²) pairs wastes almost every distance check. Bucketing
 * agents into cells of `cellSize` ≥ cutoff and visiting only same-cell +
 * forward-neighbor cells yields each candidate pair exactly once at O(n)
 * for the crowd densities this app runs.
 *
 * All buffers are reused across rebuilds (counting sort, no per-call
 * allocation once capacity is reached), because the force loop rebuilds the
 * grid every substep.
 */

export interface SpatialGrid {
  cellSize: number;
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  /** Prefix offsets into `entries`, length cols*rows + 1. */
  cellStart: Int32Array;
  /** Agent indices grouped by cell. Only the first `count` are valid. */
  entries: Int32Array;
  /** Scratch: cell index per agent. */
  cellOf: Int32Array;
  count: number;
}

/** Caps cols*rows so a degenerate spread (e.g. one agent flung far away)
 * cannot balloon the cellStart allocation; cells just get coarser. */
const MAX_GRID_DIM = 128;

export function createSpatialGrid(): SpatialGrid {
  return {
    cellSize: 1,
    cols: 0,
    rows: 0,
    minX: 0,
    minY: 0,
    cellStart: new Int32Array(0),
    entries: new Int32Array(0),
    cellOf: new Int32Array(0),
    count: 0,
  };
}

/** Rebuilds the grid from the first `n` entries of xs/ys with cells of at
 * least `cellSize` px (coarsened if the bounding box would exceed
 * MAX_GRID_DIM cells per axis). */
export function buildSpatialGrid(
  grid: SpatialGrid,
  xs: Float64Array,
  ys: Float64Array,
  n: number,
  cellSize: number
): void {
  grid.count = n;
  if (n === 0) {
    grid.cols = 0;
    grid.rows = 0;
    return;
  }

  let minX = xs[0];
  let maxX = xs[0];
  let minY = ys[0];
  let maxY = ys[0];
  for (let i = 1; i < n; i++) {
    if (xs[i] < minX) minX = xs[i];
    else if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    else if (ys[i] > maxY) maxY = ys[i];
  }

  const size = Math.max(
    cellSize,
    (maxX - minX) / MAX_GRID_DIM,
    (maxY - minY) / MAX_GRID_DIM
  );
  const cols = Math.floor((maxX - minX) / size) + 1;
  const rows = Math.floor((maxY - minY) / size) + 1;
  grid.cellSize = size;
  grid.cols = cols;
  grid.rows = rows;
  grid.minX = minX;
  grid.minY = minY;

  const cellCount = cols * rows;
  if (grid.cellStart.length < cellCount + 1) {
    grid.cellStart = new Int32Array(cellCount + 1);
  }
  if (grid.cellOf.length < n) {
    grid.cellOf = new Int32Array(n);
    grid.entries = new Int32Array(n);
  }
  const cellStart = grid.cellStart;
  const cellOf = grid.cellOf;
  const entries = grid.entries;
  cellStart.fill(0, 0, cellCount + 1);

  for (let i = 0; i < n; i++) {
    const cx = Math.floor((xs[i] - minX) / size);
    const cy = Math.floor((ys[i] - minY) / size);
    const cell = cy * cols + cx;
    cellOf[i] = cell;
    cellStart[cell + 1]++;
  }
  for (let c = 0; c < cellCount; c++) cellStart[c + 1] += cellStart[c];

  // cellStart currently holds start offsets; use a second pass with a
  // moving cursor kept in cellOf-order to place entries, then restore.
  for (let i = 0; i < n; i++) {
    const cell = cellOf[i];
    entries[cellStart[cell]] = i;
    cellStart[cell]++;
  }
  // Shift starts back down (cellStart[c] now equals end of cell c).
  for (let c = cellCount; c > 0; c--) cellStart[c] = cellStart[c - 1];
  cellStart[0] = 0;
}

/**
 * Visits every candidate pair (i, j) whose cell distance is ≤ 1, exactly
 * once per pair. Callers still do their own precise distance check; the
 * grid only guarantees no pair within `cellSize` of each other is missed.
 */
export function forEachNeighborPair(
  grid: SpatialGrid,
  callback: (i: number, j: number) => void
): void {
  const { cols, rows, cellStart, entries } = grid;
  if (grid.count === 0) return;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      const start = cellStart[cell];
      const end = cellStart[cell + 1];
      if (start === end) continue;

      // Pairs within this cell.
      for (let a = start; a < end; a++) {
        for (let b = a + 1; b < end; b++) {
          callback(entries[a], entries[b]);
        }
      }

      // Forward neighbors only, so each cross-cell pair is visited once:
      // east, south-west, south, south-east.
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k - 2);
        const ny = cy + (k === 0 ? 0 : 1);
        if (nx < 0 || nx >= cols || ny >= rows) continue;
        const neighbor = ny * cols + nx;
        const nStart = cellStart[neighbor];
        const nEnd = cellStart[neighbor + 1];
        for (let a = start; a < end; a++) {
          const i = entries[a];
          for (let b = nStart; b < nEnd; b++) {
            callback(i, entries[b]);
          }
        }
      }
    }
  }
}
