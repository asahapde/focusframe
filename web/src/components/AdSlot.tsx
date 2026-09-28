"use client";

import { useId, useState } from "react";

import type { AnalysisState, Creative, SlotId } from "@/lib/creative";
import { explainImage, explainRegion } from "@/lib/explain";
import type { NormRect, Point, Size } from "@/lib/geometry";
import { LABEL_TEXT, REGION_LABELS, isRegionLabel, type Region, type RegionLabel } from "@/lib/regions";
import type { Sample } from "@/lib/samples";
import type { RegionScore } from "@/lib/scoring";

import { RegionList } from "./RegionList";
import { Stage } from "./Stage";

type Props = {
  slot: SlotId;
  creative: Creative | null;
  analysis: AnalysisState;
  inputError: string | null;
  samples: Sample[];
  regions: Region[];
  scores: Map<string, RegionScore> | null;
  peak: Point | null;
  imageSize: Size | null;
  scoringProblem: string | null;
  selectedId: string | null;
  showHeatmap: boolean;
  opacity: number;
  onFile: (file: File) => void;
  onSample: (sample: Sample) => void;
  onRetry: () => void;
  onClear: () => void;
  onImageSize: (size: Size) => void;
  onAddRegion: (label: RegionLabel, rect: NormRect) => void;
  onChangeRegion: (region: Region) => void;
  onDeleteRegion: (id: string) => void;
  onSelect: (id: string | null) => void;
};

const DEFAULT_RECT: NormRect = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };

export function AdSlot(props: Props) {
  const { slot, creative, analysis, inputError, samples, regions, scores } = props;
  const inputId = useId();
  const [newLabel, setNewLabel] = useState<RegionLabel>("cta");

  return (
    <section className="slot" aria-labelledby={`${inputId}-title`}>
      <header className="slot__header">
        <h2 id={`${inputId}-title`} className="slot__title">
          Ad {slot}
          {creative && <span className="slot__filename">{creative.filename}</span>}
        </h2>
        <div className="slot__actions">
          <input
            id={inputId}
            className="visually-hidden file-input"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onFile(file);
              event.target.value = "";
            }}
          />
          <label htmlFor={inputId} className="button">
            {creative ? "Replace image" : "Choose image"}
          </label>
          <select
            className="select"
            aria-label={`Load a sample image into ad ${slot}`}
            value=""
            onChange={(event) => {
              const sample = samples.find((s) => s.id === event.target.value);
              if (sample) props.onSample(sample);
            }}
          >
            <option value="">Use a sample…</option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {creative && (
            <button type="button" className="button button--ghost" onClick={props.onClear}>
              Clear
            </button>
          )}
        </div>
      </header>

      {inputError && (
        <p className="notice notice--error" role="alert">
          {inputError}
        </p>
      )}

      {!creative ? (
        <div
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) props.onFile(file);
          }}
        >
          <p>Drop a PNG or JPEG here, choose a file, or pick a sample.</p>
        </div>
      ) : (
        <>
          <div className="region-toolbar">
            <label>
              <span>New region label</span>
              <select
                className="select"
                value={newLabel}
                onChange={(e) => isRegionLabel(e.target.value) && setNewLabel(e.target.value)}
              >
                {REGION_LABELS.map((l) => (
                  <option key={l} value={l}>
                    {LABEL_TEXT[l]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button" onClick={() => props.onAddRegion(newLabel, DEFAULT_RECT)}>
              Add region
            </button>
            <span className="muted">Drag on the image, or add a region and type its coordinates.</span>
          </div>
          <Stage
            src={creative.objectUrl}
            alt={`Ad ${slot}: ${creative.filename}`}
            heatmapUrl={analysis.status === "done" ? analysis.analysis.heatmap.data_url : null}
            showHeatmap={props.showHeatmap}
            opacity={props.opacity}
            regions={regions}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            onCreate={(rect) => props.onAddRegion(newLabel, rect)}
            onImageSize={props.onImageSize}
          />
        </>
      )}

      <AnalysisStatus analysis={analysis} onRetry={props.onRetry} />
      {props.scoringProblem && (
        <p className="notice notice--error" role="alert">
          {props.scoringProblem}
        </p>
      )}

      {creative && (
        <>
          <h3 className="slot__subhead">Regions</h3>
          <RegionList
            slot={slot}
            regions={regions}
            scores={scores}
            imageSize={props.imageSize}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
            onChange={props.onChangeRegion}
            onDelete={props.onDeleteRegion}
          />
        </>
      )}

      {scores && props.peak && (
        <>
          <h3 className="slot__subhead">What the model predicts</h3>
          <ul className="findings">
            {explainImage(regions, regions.map((r) => scores.get(r.id)!), props.peak).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {regions.map((r) => (
              <li key={r.id}>{explainRegion(r, scores.get(r.id)!)}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AnalysisStatus({ analysis, onRetry }: { analysis: AnalysisState; onRetry: () => void }) {
  return (
    <div className="status" aria-live="polite">
      {analysis.status === "loading" && (
        <p className="notice">
          <span className="spinner" aria-hidden="true" /> Predicting attention…
        </p>
      )}
      {analysis.status === "error" && (
        <div className="notice notice--error" role="alert">
          <p>
            <strong>Analysis failed.</strong> {analysis.message}
          </p>
          {analysis.requestId && <p className="muted">Request ID: {analysis.requestId}</p>}
          <button type="button" className="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {analysis.status === "done" && (
        <p className="notice notice--ok">
          Predicted by{" "}
          <a href={analysis.analysis.model.source_url} target="_blank" rel="noreferrer">
            {analysis.analysis.model.name}
          </a>{" "}
          on {analysis.analysis.image.width}×{analysis.analysis.image.height} px in{" "}
          {Math.round(analysis.analysis.processing.inference_ms)} ms ({analysis.analysis.processing.device}).
        </p>
      )}
    </div>
  );
}
