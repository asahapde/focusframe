"use client";

import { useState } from "react";

import { pct, times } from "@/lib/explain";
import {
  anyOverlap,
  normalizedToPixels,
  pixelsToNormalized,
  validateRect,
  type NormRect,
  type Size,
} from "@/lib/geometry";
import { LABEL_TEXT, REGION_LABELS, isRegionLabel, regionTitle, type Region } from "@/lib/regions";
import type { RegionScore } from "@/lib/scoring";

type Props = {
  slot: string;
  regions: Region[];
  scores: Map<string, RegionScore> | null;
  imageSize: Size | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (region: Region) => void;
  onDelete: (id: string) => void;
};

export function RegionList(props: Props) {
  const { regions, scores, imageSize } = props;
  if (regions.length === 0) {
    return <p className="muted">No regions yet.</p>;
  }
  return (
    <ul className="region-list">
      {regions.map((region) => (
        <li key={region.id}>
          <RegionRow
            {...props}
            region={region}
            score={scores?.get(region.id) ?? null}
            imageSize={imageSize}
            selected={region.id === props.selectedId}
          />
        </li>
      ))}
      {anyOverlap(regions.map((r) => r.rect)) && (
        <li className="muted">Overlapping regions each count the shared area, so shares can sum to more than 100%.</li>
      )}
    </ul>
  );
}

const FIELDS = [
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];

function RegionRow(
  props: Props & { region: Region; score: RegionScore | null; imageSize: Size | null; selected: boolean },
) {
  const { region, score, imageSize, slot } = props;
  const [drafts, setDrafts] = useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const idBase = `${slot}-${region.id}`;
  const px = imageSize ? normalizedToPixels(region.rect, imageSize) : null;

  const shown = (key: FieldKey) => drafts[key] ?? (px ? String(Math.round(px[key] * 10) / 10) : "");

  const commit = () => {
    if (!imageSize || Object.keys(drafts).length === 0) return;
    const next = {} as NormRect;
    for (const { key } of FIELDS) next[key] = Number(shown(key));
    const rect = pixelsToNormalized(next, imageSize);
    const problem = validateRect(rect);
    if (problem) {
      setError(`${problem} The image is ${imageSize.width}×${imageSize.height} px.`);
      return;
    }
    setError(null);
    setDrafts({});
    props.onChange({ ...region, rect });
  };

  return (
    <fieldset
      className={`region-row${props.selected ? " region-row--selected" : ""}`}
      onFocus={() => props.onSelect(region.id)}
    >
      <legend className={`region-row__legend region-tag--${region.label}`}>{regionTitle(region)}</legend>
      <div className="region-row__meta">
        <label>
          <span>Label</span>
          <select
            className="select"
            value={region.label}
            onChange={(e) => isRegionLabel(e.target.value) && props.onChange({ ...region, label: e.target.value })}
          >
            {REGION_LABELS.map((l) => (
              <option key={l} value={l}>
                {LABEL_TEXT[l]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Name</span>
          <input
            className="input"
            value={region.name ?? ""}
            maxLength={40}
            placeholder="optional"
            onChange={(e) => props.onChange({ ...region, name: e.target.value || undefined })}
          />
        </label>
        <button type="button" className="button button--ghost" onClick={() => props.onDelete(region.id)}>
          Delete<span className="visually-hidden"> {regionTitle(region)}</span>
        </button>
      </div>
      <div className="region-row__coords" role="group" aria-label="Position and size in image pixels">
        {FIELDS.map(({ key, label }) => (
          <label key={key}>
            <span>{label} (px)</span>
            <input
              className="input input--num"
              type="number"
              inputMode="decimal"
              step="1"
              min={0}
              disabled={!imageSize}
              value={shown(key)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${idBase}-err` : undefined}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
          </label>
        ))}
      </div>
      {error && (
        <p id={`${idBase}-err`} className="field-error" role="alert">
          {error}
        </p>
      )}
      <dl className="metrics">
        <div>
          <dt>Area</dt>
          <dd>{score ? pct(score.areaFraction) : pct(region.rect.width * region.rect.height)}</dd>
        </div>
        <div>
          <dt>Predicted attention</dt>
          <dd>{score ? pct(score.attentionMass) : "–"}</dd>
        </div>
        <div>
          <dt>Lift vs uniform</dt>
          <dd>{score ? times(score.lift) : "–"}</dd>
        </div>
      </dl>
    </fieldset>
  );
}
