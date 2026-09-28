import type { Grid } from "./density";
import type { NormRect, Point } from "./geometry";

export type RegionScore = {
  /** Fraction of the model's predicted attention inside the region, 0..1. */
  attentionMass: number;
  /** Fraction of the image area covered by the region, 0..1. */
  areaFraction: number;
  /** attentionMass / areaFraction; 1 means "same as uniform attention". */
  lift: number;
};

function gridTotal(grid: Grid): number {
  let total = 0;
  for (let i = 0; i < grid.values.length; i++) total += grid.values[i];
  return total;
}

/**
 * Sum the density inside a normalized rectangle.
 *
 * Grid cell (r, c) covers x in [c/W, (c+1)/W) and y in [r/H, (r+1)/H). A cell
 * partially covered by the rectangle contributes in proportion to the covered
 * fraction of its area (density is assumed uniform within a cell). The result
 * is divided by the grid total so float32 rounding cannot push a full-image
 * region above or below exactly 1.
 */
export function attentionMass(grid: Grid, rect: NormRect): number {
  const { width: W, height: H, values } = grid;
  const x0 = Math.max(0, rect.x) * W;
  const x1 = Math.min(1, rect.x + rect.width) * W;
  const y0 = Math.max(0, rect.y) * H;
  const y1 = Math.min(1, rect.y + rect.height) * H;
  if (x1 <= x0 || y1 <= y0) return 0;

  let mass = 0;
  for (let r = Math.floor(y0); r < Math.min(H, Math.ceil(y1)); r++) {
    const wy = Math.min(r + 1, y1) - Math.max(r, y0);
    if (wy <= 0) continue;
    let rowSum = 0;
    for (let c = Math.floor(x0); c < Math.min(W, Math.ceil(x1)); c++) {
      const wx = Math.min(c + 1, x1) - Math.max(c, x0);
      if (wx > 0) rowSum += wx * values[r * W + c];
    }
    mass += wy * rowSum;
  }
  const total = gridTotal(grid);
  return total > 0 ? mass / total : 0;
}

export function scoreRegion(grid: Grid, rect: NormRect): RegionScore {
  const areaFraction = rect.width * rect.height;
  const mass = attentionMass(grid, rect);
  return {
    attentionMass: mass,
    areaFraction,
    lift: areaFraction > 0 ? mass / areaFraction : Number.NaN,
  };
}

/** Normalized centre of the grid cell with the highest predicted density. */
export function peakLocation(grid: Grid): Point {
  let best = 0;
  for (let i = 1; i < grid.values.length; i++) {
    if (grid.values[i] > grid.values[best]) best = i;
  }
  const r = Math.floor(best / grid.width);
  const c = best % grid.width;
  return { x: (c + 0.5) / grid.width, y: (r + 0.5) / grid.height };
}
