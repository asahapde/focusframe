import type { Region } from "./regions";

/** User decisions keyed by region A id: a region B id, or null for "do not compare". */
export type PairChoices = Record<string, string | null>;

export type RegionPair = { a: Region; b: Region; automatic: boolean };

export type Comparison = {
  pairs: RegionPair[];
  /** A regions with same-label candidates in B that need an explicit choice. */
  needsChoice: { a: Region; candidates: Region[] }[];
  unmatchedA: Region[];
  unmatchedB: Region[];
};

/**
 * Pair regions across two ads. Only regions with the same label can be
 * compared. A non-custom label that appears exactly once in each ad is paired
 * automatically; every other pairing (repeated labels, custom regions) must
 * be chosen explicitly. Nothing else is ever paired.
 */
export function compareRegions(a: Region[], b: Region[], choices: PairChoices): Comparison {
  const pairs: RegionPair[] = [];
  const usedB = new Set<string>();
  const pairedA = new Set<string>();
  const byId = new Map(b.map((r) => [r.id, r]));

  const count = (list: Region[], label: string) => list.filter((r) => r.label === label).length;

  for (const ra of a) {
    const choice = choices[ra.id];
    if (choice === null) continue;
    if (choice !== undefined) {
      const rb = byId.get(choice);
      if (rb && rb.label === ra.label && !usedB.has(rb.id)) {
        pairs.push({ a: ra, b: rb, automatic: false });
        usedB.add(rb.id);
        pairedA.add(ra.id);
      }
      continue;
    }
    if (ra.label !== "custom" && count(a, ra.label) === 1 && count(b, ra.label) === 1) {
      const rb = b.find((r) => r.label === ra.label)!;
      if (!usedB.has(rb.id)) {
        pairs.push({ a: ra, b: rb, automatic: true });
        usedB.add(rb.id);
        pairedA.add(ra.id);
      }
    }
  }

  const needsChoice: Comparison["needsChoice"] = [];
  const unmatchedA: Region[] = [];
  for (const ra of a) {
    if (pairedA.has(ra.id)) continue;
    const candidates = b.filter((rb) => rb.label === ra.label && !usedB.has(rb.id));
    if (candidates.length > 0 && choices[ra.id] !== null) {
      needsChoice.push({ a: ra, candidates });
    } else {
      unmatchedA.push(ra);
    }
  }
  const unmatchedB = b.filter((rb) => !usedB.has(rb.id));
  return { pairs, needsChoice, unmatchedA, unmatchedB };
}
