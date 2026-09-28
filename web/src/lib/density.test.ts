import { describe, expect, it } from "vitest";

import { decodeDensity } from "./density";

const base = { encoding: "base64-float32-le", layout: "row-major-top-left", sum: 3 } as const;

describe("decodeDensity", () => {
  it("decodes the same little-endian vector the Python encoder test produces", () => {
    // api/tests/test_density.py: encode_float32_le([[1.0, 2.0]]) == "AACAPwAAAEA="
    const grid = decodeDensity({ ...base, width: 2, height: 1, data: "AACAPwAAAEA=" });
    expect(Array.from(grid.values)).toEqual([1, 2]);
  });

  it("rejects data whose length does not match the dimensions", () => {
    expect(() => decodeDensity({ ...base, width: 3, height: 1, data: "AACAPwAAAEA=" })).toThrow();
  });
});
