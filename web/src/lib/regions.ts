import type { NormRect } from "./geometry";

export const REGION_LABELS = ["product", "headline", "logo", "cta", "custom"] as const;
export type RegionLabel = (typeof REGION_LABELS)[number];

export const LABEL_TEXT: Record<RegionLabel, string> = {
  product: "Product",
  headline: "Headline",
  logo: "Brand / logo",
  cta: "Call to action",
  custom: "Custom",
};

export type Region = {
  id: string;
  label: RegionLabel;
  name?: string;
  rect: NormRect; // normalized 0..1
};

export function isRegionLabel(value: string): value is RegionLabel {
  return (REGION_LABELS as readonly string[]).includes(value);
}

export function regionTitle(region: Region): string {
  const base = LABEL_TEXT[region.label];
  return region.name && region.name !== base ? `${base}: ${region.name}` : base;
}
