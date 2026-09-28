import { describe, expect, it } from "vitest";

import {
  anyOverlap,
  displayToNormalized,
  normalizedToPixels,
  pixelsToNormalized,
  rectFromPoints,
  validateRect,
} from "./geometry";

describe("displayToNormalized", () => {
  const box = { left: 100, top: 50, width: 400, height: 200 };

  it("subtracts the element offset and divides by the rendered size", () => {
    expect(displayToNormalized(300, 100, box)).toEqual({ x: 0.5, y: 0.25 });
  });

  it("clamps pointer positions outside the image", () => {
    expect(displayToNormalized(0, 1000, box)).toEqual({ x: 0, y: 1 });
  });

  it("maps the same image point to the same coordinates at any display size", () => {
    // Pixel (300, 157) of a 1200x628 image, shown at 400 px and 1000 px wide.
    const small = { left: 10, top: 20, width: 400, height: (400 * 628) / 1200 };
    const large = { left: 0, top: 0, width: 1000, height: (1000 * 628) / 1200 };
    const a = displayToNormalized(10 + (300 / 1200) * 400, 20 + (157 / 628) * small.height, small);
    const b = displayToNormalized((300 / 1200) * 1000, (157 / 628) * large.height, large);
    expect(a.x).toBeCloseTo(0.25, 12);
    expect(a.y).toBeCloseTo(0.25, 12);
    expect(b.x).toBeCloseTo(a.x, 12);
    expect(b.y).toBeCloseTo(a.y, 12);
  });
});

describe("rectFromPoints", () => {
  it("normalizes a drag in any direction", () => {
    const r = rectFromPoints({ x: 0.7, y: 0.9 }, { x: 0.2, y: 0.4 });
    expect(r.x).toBeCloseTo(0.2);
    expect(r.y).toBeCloseTo(0.4);
    expect(r.width).toBeCloseTo(0.5);
    expect(r.height).toBeCloseTo(0.5);
  });
});

describe("pixel conversion", () => {
  it("round-trips a pixel rectangle through normalized coordinates", () => {
    const image = { width: 1200, height: 628 };
    const px = { x: 62, y: 540, width: 170, height: 44 };
    const norm = pixelsToNormalized(px, image);
    expect(norm.x).toBeCloseTo(62 / 1200, 12);
    expect(norm.y + norm.height).toBeCloseTo(584 / 628, 12);
    const back = normalizedToPixels(norm, image);
    for (const key of ["x", "y", "width", "height"] as const) expect(back[key]).toBeCloseTo(px[key], 9);
  });
});

describe("validateRect", () => {
  it.each([
    [{ x: 0, y: 0, width: 1, height: 1 }, null],
    [{ x: 0.5, y: 0.5, width: 0, height: 0.1 }, "Width and height must be greater than zero."],
    [{ x: -0.1, y: 0, width: 0.2, height: 0.2 }, "The region must start inside the image."],
    [{ x: 0.9, y: 0, width: 0.2, height: 0.2 }, "The region must end inside the image."],
    [{ x: Number.NaN, y: 0, width: 0.2, height: 0.2 }, "Coordinates must be numbers."],
  ])("%o -> %s", (rect, expected) => {
    expect(validateRect(rect)).toBe(expected);
  });
});

describe("anyOverlap", () => {
  it("treats rectangles that only share an edge as non-overlapping", () => {
    expect(anyOverlap([{ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 }])).toBe(false);
    expect(anyOverlap([{ x: 0, y: 0, width: 0.6, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 }])).toBe(true);
  });
});
