import type { AnalysisResponse } from "./api/types";
import type { SlotId } from "./creative";
import type { Comparison } from "./pairing";
import type { Region } from "./regions";
import type { RegionScore } from "./scoring";

export type SlotExport = {
  filename: string;
  analysis: AnalysisResponse | null;
  regions: Region[];
  scores: Map<string, RegionScore> | null;
};

/** A JSON summary of the session. Contains no image bytes or heatmap pixels. */
export function buildExport(slots: Partial<Record<SlotId, SlotExport>>, comparison: Comparison | null) {
  const ad = (s: SlotExport) => ({
    filename: s.filename,
    analysis_id: s.analysis?.analysis_id ?? null,
    model: s.analysis?.model ? { name: s.analysis.model.name, version: s.analysis.model.version } : null,
    image: s.analysis?.image ?? null,
    processing: s.analysis?.processing ?? null,
    regions: s.regions.map((r) => {
      const score = s.scores?.get(r.id);
      return {
        id: r.id,
        label: r.label,
        name: r.name ?? null,
        rect_normalized: r.rect,
        area_fraction: score?.areaFraction ?? r.rect.width * r.rect.height,
        attention_mass: score?.attentionMass ?? null,
        lift: score && Number.isFinite(score.lift) ? score.lift : null,
      };
    }),
  });
  return {
    tool: "FocusFrame",
    exported_at: new Date().toISOString(),
    disclaimer:
      "Predicted free-viewing attention from a pretrained saliency model. Not eye tracking, " +
      "and not a prediction of clicks, conversions, or sales.",
    ads: Object.fromEntries(Object.entries(slots).map(([k, s]) => [k, s ? ad(s) : null])),
    comparison: comparison
      ? {
          pairs: comparison.pairs.map((p) => ({ a: p.a.id, b: p.b.id, automatic: p.automatic })),
          unmatched_a: comparison.unmatchedA.map((r) => r.id),
          unmatched_b: comparison.unmatchedB.map((r) => r.id),
        }
      : null,
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
