import { describe, expect, it } from "vitest";

import type { AnalysisResponse } from "./api/types";
import { buildExport } from "./exportResults";

const analysis = {
  schema_version: "1",
  analysis_id: "id-1",
  model: { name: "DeepGaze IIE", version: "v" },
  image: { width: 100, height: 50 },
  density: { data: "DENSITY-BYTES" },
  heatmap: { data_url: "data:image/png;base64,HEATMAP-BYTES" },
  processing: { device: "cpu" },
} as unknown as AnalysisResponse;

describe("buildExport", () => {
  it("includes scores and metadata but never image, heatmap, or density bytes", () => {
    const region = { id: "r1", label: "cta" as const, rect: { x: 0, y: 0, width: 0.5, height: 0.5 } };
    const scores = new Map([["r1", { attentionMass: 0.4, areaFraction: 0.25, lift: 1.6 }]]);
    const out = buildExport({ A: { filename: "a.png", analysis, regions: [region], scores } }, null);
    const text = JSON.stringify(out);
    expect(text).not.toContain("HEATMAP-BYTES");
    expect(text).not.toContain("DENSITY-BYTES");
    expect(out.ads.A?.regions[0]).toMatchObject({ attention_mass: 0.4, area_fraction: 0.25, lift: 1.6 });
    expect(out.disclaimer).toContain("not a prediction of clicks");
  });
});
