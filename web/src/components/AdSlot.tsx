"use client";

import { useId, useRef } from "react";

import type { AnalysisState, Creative, SlotId } from "@/lib/creative";
import type { Sample } from "@/lib/samples";

type Props = {
  slot: SlotId;
  creative: Creative | null;
  analysis: AnalysisState;
  inputError: string | null;
  samples: Sample[];
  onFile: (file: File) => void;
  onSample: (sample: Sample) => void;
  onRetry: () => void;
  onClear: () => void;
};

export function AdSlot(props: Props) {
  const { slot, creative, analysis, inputError, samples } = props;
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <section className="slot" aria-labelledby={`${inputId}-title`}>
      <header className="slot__header">
        <h2 id={`${inputId}-title`} className="slot__title">
          Ad {slot}
          {creative && <span className="slot__filename">{creative.filename}</span>}
        </h2>
        <div className="slot__actions">
          <input
            ref={fileInput}
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
        <div className="stage">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
          <img className="stage__image" src={creative.objectUrl} alt={`Ad ${slot} preview`} />
        </div>
      )}

      <AnalysisStatus analysis={analysis} onRetry={props.onRetry} />
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
          Analysis ready: {analysis.analysis.model.name} ({analysis.analysis.image.width}×
          {analysis.analysis.image.height} px)
        </p>
      )}
    </div>
  );
}
