import { describe, expect, it } from "vitest";

import { compareRegions } from "./pairing";
import type { Region, RegionLabel } from "./regions";

const rect = { x: 0, y: 0, width: 0.1, height: 0.1 };
const r = (id: string, label: RegionLabel, name?: string): Region => ({ id, label, name, rect });

const ids = (list: Region[]) => list.map((x) => x.id);

describe("compareRegions", () => {
  it("auto-pairs a label that appears exactly once in each ad", () => {
    const c = compareRegions([r("a1", "cta"), r("a2", "logo")], [r("b1", "logo"), r("b2", "cta")], {});
    expect(c.pairs.map((p) => [p.a.id, p.b.id, p.automatic])).toEqual([
      ["a1", "b2", true],
      ["a2", "b1", true],
    ]);
    expect(c.unmatchedA).toEqual([]);
    expect(c.unmatchedB).toEqual([]);
  });

  it("requires an explicit choice when a label repeats, and never pairs unlike labels", () => {
    const a = [r("a1", "cta"), r("a2", "headline")];
    const b = [r("b1", "cta"), r("b2", "cta"), r("b3", "product")];
    const c = compareRegions(a, b, {});
    expect(c.pairs).toEqual([]);
    expect(c.needsChoice.map((n) => [n.a.id, ids(n.candidates)])).toEqual([["a1", ["b1", "b2"]]]);
    expect(ids(c.unmatchedA)).toEqual(["a2"]);
    expect(ids(c.unmatchedB)).toEqual(["b1", "b2", "b3"]);
  });

  it("uses explicit choices and ignores choices across labels", () => {
    const a = [r("a1", "cta"), r("a2", "headline")];
    const b = [r("b1", "cta"), r("b2", "cta")];
    const c = compareRegions(a, b, { a1: "b2", a2: "b1" });
    expect(c.pairs.map((p) => [p.a.id, p.b.id, p.automatic])).toEqual([["a1", "b2", false]]);
    expect(ids(c.unmatchedA)).toEqual(["a2"]);
    expect(ids(c.unmatchedB)).toEqual(["b1"]);
  });

  it("never auto-pairs custom regions, even with matching names", () => {
    const c = compareRegions([r("a1", "custom", "Badge")], [r("b1", "custom", "Badge")], {});
    expect(c.pairs).toEqual([]);
    expect(c.needsChoice).toHaveLength(1);
  });

  it("respects an explicit decision not to compare", () => {
    const c = compareRegions([r("a1", "cta")], [r("b1", "cta")], { a1: null });
    expect(c.pairs).toEqual([]);
    expect(c.needsChoice).toEqual([]);
    expect(ids(c.unmatchedA)).toEqual(["a1"]);
  });

  it("does not use one B region twice", () => {
    const c = compareRegions([r("a1", "cta"), r("a2", "cta")], [r("b1", "cta")], { a1: "b1", a2: "b1" });
    expect(c.pairs.map((p) => p.a.id)).toEqual(["a1"]);
    expect(ids(c.unmatchedA)).toEqual(["a2"]);
  });

  it("asks again when the chosen B region was deleted", () => {
    const c = compareRegions([r("a1", "cta")], [r("b9", "cta"), r("b8", "cta")], { a1: "gone" });
    expect(c.needsChoice.map((n) => n.a.id)).toEqual(["a1"]);
  });
});
