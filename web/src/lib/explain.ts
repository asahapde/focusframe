/**
 * Deterministic, template-based explanations. Every sentence restates a
 * measured model output; wording thresholds are fixed constants below.
 */
import { anyOverlap, type Point } from "./geometry";
import type { RegionPair } from "./pairing";
import { LABEL_TEXT, type Region } from "./regions";
import type { RegionScore } from "./scoring";

/** Lift at or above this reads as "more than its size suggests". */
export const HIGH_LIFT = 1.5;
/** Lift at or below this reads as "less than its size suggests". */
export const LOW_LIFT = 1 / HIGH_LIFT;
/** Differences in attention share below this (percentage points) read as "similar". */
export const SIMILAR_PP = 0.5;
/** Area ratio above which lift, not raw share, is called out as the fairer comparison. */
export const AREA_RATIO_NOTE = 1.5;

export function pct(fraction: number): string {
  const v = fraction * 100;
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
}

export function times(lift: number): string {
  return Number.isFinite(lift) ? `${lift.toFixed(2)}×` : "n/a";
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function describeTitle(region: Region): string {
  if (region.label === "custom") return `the region “${region.name || "Custom"}”`;
  const base = `the ${LABEL_TEXT[region.label].toLowerCase()}`;
  return region.name && region.name !== LABEL_TEXT[region.label] ? `${base} (“${region.name}”)` : base;
}

export function explainRegion(region: Region, score: RegionScore): string {
  const subject = describeTitle(region);
  const facts =
    `${sentenceCase(subject)} occupies ${pct(score.areaFraction)} of the image and receives ` +
    `${pct(score.attentionMass)} of predicted attention (${times(score.lift)} uniform).`;
  if (score.lift >= HIGH_LIFT) {
    return `${facts} The model predicts more attention here than its size alone would.`;
  }
  if (score.lift <= LOW_LIFT) {
    const suggestion =
      region.label === "custom"
        ? ""
        : " If it matters, consider testing a more prominent placement, size, or contrast.";
    return `${facts} The model predicts less attention here than its size alone would.${suggestion}`;
  }
  return `${facts} Its share is roughly in proportion to its size.`;
}

function contains(region: Region, p: Point): boolean {
  const r = region.rect;
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function explainImage(regions: Region[], scores: RegionScore[], peak: Point): string[] {
  const out: string[] = [];
  const peakIn = regions.filter((r) => contains(r, peak));
  if (regions.length === 0) {
    return ["Mark regions to see how much predicted attention falls inside them."];
  }
  out.push(
    peakIn.length > 0
      ? `The highest predicted density falls inside ${peakIn.map(describeTitle).join(" and ")}.`
      : `The highest predicted density falls outside all marked regions (about ${pct(peak.x)} across, ${pct(peak.y)} down).`,
  );
  if (anyOverlap(regions.map((r) => r.rect))) {
    out.push("Some regions overlap, so their attention shares can add up to more than 100%.");
  } else {
    const area = scores.reduce((s, x) => s + x.areaFraction, 0);
    const mass = scores.reduce((s, x) => s + x.attentionMass, 0);
    out.push(
      `Together the marked regions cover ${pct(area)} of the image and receive ${pct(mass)} of ` +
        `predicted attention; ${pct(Math.max(0, 1 - mass))} falls elsewhere.`,
    );
  }
  return out;
}

export function explainPair(pair: RegionPair, a: RegionScore, b: RegionScore): string {
  const label = pair.a.label === "custom" ? `“${pair.a.name || "Custom"}”` : LABEL_TEXT[pair.a.label];
  const diffPp = (b.attentionMass - a.attentionMass) * 100;
  const parts = [
    `${label}: in A it covers ${pct(a.areaFraction)} and receives ${pct(a.attentionMass)} of predicted ` +
      `attention; in B it covers ${pct(b.areaFraction)} and receives ${pct(b.attentionMass)}.`,
  ];
  if (Math.abs(diffPp) < SIMILAR_PP) {
    parts.push("The predicted shares are similar.");
  } else {
    parts.push(
      `B's receives ${Math.abs(diffPp).toFixed(1)} percentage points ${diffPp > 0 ? "more" : "less"} than A's.`,
    );
  }
  const ratio = Math.max(a.areaFraction, b.areaFraction) / Math.min(a.areaFraction, b.areaFraction);
  if (ratio > AREA_RATIO_NOTE) {
    parts.push(
      `The regions differ in size (${ratio.toFixed(1)}× larger in ${b.areaFraction > a.areaFraction ? "B" : "A"}), ` +
        `so lift is the fairer comparison: A ${times(a.lift)} vs B ${times(b.lift)}.`,
    );
  }
  return parts.join(" ");
}
