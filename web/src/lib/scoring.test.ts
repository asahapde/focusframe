import { describe, expect, it } from "vitest";

import type { Grid } from "./density";
import { attentionMass, peakLocation, scoreRegion } from "./scoring";

function grid(width: number, height: number, fill: (r: number, c: number) => number): Grid {
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = fill(r, c);
  return { width, height, values };
}

const uniform = (w: number, h: number) => grid(w, h, () => 1 / (w * h));
/** 4x4 grid with all mass in row 1, column 2: x in [0.5, 0.75), y in [0.25, 0.5). */
const hotCell = grid(4, 4, (r, c) => (r === 1 && c === 2 ? 1 : 0));

describe("scoreRegion on a uniform density", () => {
  it.each([
    { x: 0.13, y: 0.21, width: 0.4, height: 0.37 },
    { x: 0, y: 0, width: 0.001, height: 1 },
    { x: 0.999, y: 0.5, width: 0.001, height: 0.5 },
  ])("attention equals area and lift is 1 for %o", (rect) => {
    const score = scoreRegion(uniform(7, 5), rect);
    expect(score.attentionMass).toBeCloseTo(rect.width * rect.height, 9);
    expect(score.lift).toBeCloseTo(1, 6);
  });
});

describe("attentionMass", () => {
  it("is exactly 1 for the full image even if the float32 grid does not sum to 1", () => {
    const g = grid(3, 3, () => 0.99 / 9);
    expect(attentionMass(g, { x: 0, y: 0, width: 1, height: 1 })).toBeCloseTo(1, 12);
  });

  it("counts a partially covered cell by its covered fraction", () => {
    // Left half of the hot cell.
    expect(attentionMass(hotCell, { x: 0.5, y: 0.25, width: 0.125, height: 0.25 })).toBeCloseTo(0.5, 12);
    // A quarter: half the width and half the height.
    expect(attentionMass(hotCell, { x: 0.625, y: 0.375, width: 0.125, height: 0.125 })).toBeCloseTo(0.25, 12);
  });

  it("does not leak mass across a shared cell boundary", () => {
    expect(attentionMass(hotCell, { x: 0.75, y: 0, width: 0.25, height: 1 })).toBe(0);
    expect(attentionMass(hotCell, { x: 0, y: 0, width: 0.5, height: 1 })).toBe(0);
    expect(attentionMass(hotCell, { x: 0, y: 0.5, width: 1, height: 0.5 })).toBe(0);
  });

  it("handles rectangles touching the image edges", () => {
    const g = grid(4, 4, (r, c) => (r === 3 && c === 3 ? 1 : 0));
    expect(attentionMass(g, { x: 0.8, y: 0.8, width: 0.2, height: 0.2 })).toBeCloseTo(0.64, 12);
  });

  it("lets overlapping regions sum to more than 1", () => {
    const g = uniform(10, 10);
    const left = attentionMass(g, { x: 0, y: 0, width: 0.6, height: 1 });
    const right = attentionMass(g, { x: 0.4, y: 0, width: 0.6, height: 1 });
    expect(left + right).toBeCloseTo(1.2, 9);
  });

  it("gives the same score on grids of different resolution when density is smooth", () => {
    // Density linear in x: p(x) = 2x. Mass over x in [0.2, 0.7] = 0.7^2 - 0.2^2 = 0.45.
    const linear = (w: number) => grid(w, 3, (_r, c) => (2 * (c + 0.5)) / w / (w * 3));
    const rect = { x: 0.2, y: 0, width: 0.5, height: 1 };
    // Edges align with cells at width 10: exact up to float32 storage precision.
    expect(attentionMass(linear(10), rect)).toBeCloseTo(0.45, 6);
    // At width 128 the edges cut cells; the within-cell-uniform assumption costs < 1e-4.
    expect(Math.abs(attentionMass(linear(128), rect) - 0.45)).toBeLessThan(1e-4);
  });
});

describe("peakLocation", () => {
  it("returns the centre of the highest cell in normalized coordinates", () => {
    expect(peakLocation(hotCell)).toEqual({ x: 0.625, y: 0.375 });
  });
});
