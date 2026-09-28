import { describe, expect, it } from "vitest";

import { explainImage, explainPair, explainRegion } from "./explain";
import type { Region } from "./regions";

const cta: Region = { id: "a", label: "cta", rect: { x: 0.1, y: 0.8, width: 0.2, height: 0.35 } };

describe("explainRegion", () => {
  it("states the measured numbers and suggests testing when a key region is under-attended", () => {
    const text = explainRegion(cta, { areaFraction: 0.07, attentionMass: 0.03, lift: 0.03 / 0.07 });
    expect(text).toContain("occupies 7.0% of the image and receives 3.0% of predicted attention");
    expect(text).toContain("0.43×");
    expect(text).toContain("consider testing a more prominent placement");
  });

  it("does not suggest changes when attention is proportional to size", () => {
    const text = explainRegion(cta, { areaFraction: 0.1, attentionMass: 0.11, lift: 1.1 });
    expect(text).toContain("roughly in proportion");
    expect(text).not.toContain("consider");
  });
});

describe("explainPair", () => {
  const b: Region = { ...cta, id: "b" };

  it("reports the percentage-point difference and flags size differences", () => {
    const text = explainPair(
      { a: cta, b, automatic: true },
      { areaFraction: 0.01, attentionMass: 0.004, lift: 0.4 },
      { areaFraction: 0.04, attentionMass: 0.1, lift: 2.5 },
    );
    expect(text).toContain("9.6 percentage points more");
    expect(text).toContain("4.0× larger in B");
    expect(text).toContain("A 0.40× vs B 2.50×");
  });

  it("calls small differences similar", () => {
    const s = { areaFraction: 0.05, attentionMass: 0.05, lift: 1 };
    const text = explainPair({ a: cta, b, automatic: true }, s, { ...s, attentionMass: 0.052 });
    expect(text).toContain("similar");
  });

  it("flags differences smaller than the measured framing sensitivity", () => {
    const s = { areaFraction: 0.05, attentionMass: 0.05, lift: 1 };
    const small = explainPair({ a: cta, b, automatic: true }, s, { ...s, attentionMass: 0.065 });
    expect(small).toContain("1.5 percentage points more");
    expect(small).toContain("no clear difference");
    const large = explainPair({ a: cta, b, automatic: true }, s, { ...s, attentionMass: 0.08 });
    expect(large).not.toContain("no clear difference");
  });
});

describe("explainImage", () => {
  it("reports where the peak is and the remainder outside non-overlapping regions", () => {
    const lines = explainImage(
      [{ ...cta, rect: { x: 0, y: 0, width: 0.5, height: 0.5 } }],
      [{ areaFraction: 0.25, attentionMass: 0.6, lift: 2.4 }],
      { x: 0.25, y: 0.25 },
    );
    expect(lines[0]).toContain("inside the call to action");
    expect(lines[1]).toContain("40%");
  });
});
