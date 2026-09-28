/**
 * Coordinate frames:
 * - display: CSS pixels of the rendered image element (changes with layout)
 * - normalized: [0,1] x [0,1] over the full image, top-left origin (stored)
 * - image pixels: the oriented source image, as reported by the API
 * - grid cells: the API density grid (see scoring.ts)
 */

export type NormRect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

const EPS = 1e-9;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Pointer position (client coordinates) to a clamped normalized image point. */
export function displayToNormalized(clientX: number, clientY: number, box: Box): Point {
  return {
    x: clamp01((clientX - box.left) / box.width),
    y: clamp01((clientY - box.top) / box.height),
  };
}

/** Rectangle spanned by two normalized points, regardless of drag direction. */
export function rectFromPoints(a: Point, b: Point): NormRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function normalizedToPixels(rect: NormRect, image: Size): NormRect {
  return {
    x: rect.x * image.width,
    y: rect.y * image.height,
    width: rect.width * image.width,
    height: rect.height * image.height,
  };
}

export function pixelsToNormalized(rect: NormRect, image: Size): NormRect {
  return {
    x: rect.x / image.width,
    y: rect.y / image.height,
    width: rect.width / image.width,
    height: rect.height / image.height,
  };
}

/** Returns a human-readable problem, or null if the rectangle is a valid region. */
export function validateRect(rect: NormRect): string | null {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every(Number.isFinite)) return "Coordinates must be numbers.";
  if (rect.width <= 0 || rect.height <= 0) return "Width and height must be greater than zero.";
  if (rect.x < -EPS || rect.y < -EPS) return "The region must start inside the image.";
  if (rect.x + rect.width > 1 + EPS || rect.y + rect.height > 1 + EPS) {
    return "The region must end inside the image.";
  }
  return null;
}

/** Area of the intersection of two rectangles, in normalized units. */
export function intersectionArea(a: NormRect, b: NormRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function anyOverlap(rects: NormRect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (intersectionArea(rects[i], rects[j]) > EPS) return true;
    }
  }
  return false;
}
