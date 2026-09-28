"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnalysisError, requestAnalysis } from "@/lib/api/client";
import type { AnalysisState, Creative, SlotId } from "@/lib/creative";
import { newId } from "@/lib/creative";
import { decodeDensity, type Grid } from "@/lib/density";
import { buildExport, downloadJson } from "@/lib/exportResults";
import { checkFileBeforeUpload } from "@/lib/files";
import type { NormRect, Point, Size } from "@/lib/geometry";
import { compareRegions, type PairChoices } from "@/lib/pairing";
import { isRegionLabel, type Region, type RegionLabel } from "@/lib/regions";
import { SAMPLES, fetchSampleBlob, type Sample } from "@/lib/samples";
import { peakLocation, scoreRegion, type RegionScore } from "@/lib/scoring";

import { AdSlot } from "./AdSlot";
import { ComparisonPanel } from "./ComparisonPanel";

type SlotState = {
  creative: Creative | null;
  analysis: AnalysisState;
  inputError: string | null;
  regions: Region[];
  naturalSize: Size | null;
  selectedId: string | null;
};

type Derived = {
  scores: Map<string, RegionScore> | null;
  peak: Point | null;
  imageSize: Size | null;
  scoringProblem: string | null;
};

const EMPTY_SLOT: SlotState = {
  creative: null,
  analysis: { status: "idle" },
  inputError: null,
  regions: [],
  naturalSize: null,
  selectedId: null,
};
const SLOTS: SlotId[] = ["A", "B"];

function sampleRegions(sample: Sample): Region[] {
  return sample.regions.map((r) => ({
    id: newId(),
    label: isRegionLabel(r.label) ? r.label : "custom",
    name: r.name,
    rect: r.rect,
  }));
}

function derive(slot: SlotState): Derived {
  const analysis = slot.analysis.status === "done" ? slot.analysis.analysis : null;
  const imageSize = analysis ? analysis.image : slot.naturalSize;
  if (!analysis) return { scores: null, peak: null, imageSize, scoringProblem: null };

  const natural = slot.naturalSize;
  if (natural && (natural.width !== analysis.image.width || natural.height !== analysis.image.height)) {
    return {
      scores: null,
      peak: null,
      imageSize,
      scoringProblem:
        `The browser shows this image at ${natural.width}×${natural.height} px but the API analyzed ` +
        `${analysis.image.width}×${analysis.image.height} px (likely an EXIF orientation difference). ` +
        "Scores are hidden to avoid misaligned results; re-export the image without rotation metadata.",
    };
  }
  let grid: Grid;
  try {
    grid = decodeDensity(analysis.density);
  } catch (err) {
    return { scores: null, peak: null, imageSize, scoringProblem: String(err) };
  }
  const scores = new Map(slot.regions.map((r) => [r.id, scoreRegion(grid, r.rect)]));
  return { scores, peak: peakLocation(grid), imageSize, scoringProblem: null };
}

export function Workspace() {
  const [slots, setSlots] = useState<Record<SlotId, SlotState>>({ A: EMPTY_SLOT, B: EMPTY_SLOT });
  const [choices, setChoices] = useState<PairChoices>({});
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [opacity, setOpacity] = useState(0.7);
  const controllers = useRef<Partial<Record<SlotId, AbortController>>>({});
  const urls = useRef<Partial<Record<SlotId, string>>>({});

  const patchSlot = useCallback((slot: SlotId, patch: Partial<SlotState> | ((s: SlotState) => Partial<SlotState>)) => {
    setSlots((prev) => {
      const next = typeof patch === "function" ? patch(prev[slot]) : patch;
      return { ...prev, [slot]: { ...prev[slot], ...next } };
    });
  }, []);

  useEffect(() => {
    const ownedUrls = urls.current;
    const ownedControllers = controllers.current;
    return () => {
      Object.values(ownedUrls).forEach((url) => url && URL.revokeObjectURL(url));
      Object.values(ownedControllers).forEach((c) => c?.abort());
    };
  }, []);

  const analyze = useCallback(
    async (slot: SlotId, creative: Creative) => {
      controllers.current[slot]?.abort();
      const controller = new AbortController();
      controllers.current[slot] = controller;
      patchSlot(slot, { analysis: { status: "loading", startedAt: Date.now() } });
      try {
        const analysis = await requestAnalysis(creative.blob, creative.filename, { signal: controller.signal });
        if (controller.signal.aborted) return;
        patchSlot(slot, { analysis: { status: "done", analysis, receivedAt: Date.now() } });
      } catch (err) {
        if (controller.signal.aborted) return;
        const e =
          err instanceof AnalysisError
            ? err
            : new AnalysisError("unexpected", "Something went wrong during analysis.", null, null);
        patchSlot(slot, { analysis: { status: "error", code: e.code, message: e.message, requestId: e.requestId } });
      }
    },
    [patchSlot],
  );

  const setCreative = useCallback(
    (slot: SlotId, blob: Blob, filename: string, source: Creative["source"], regions: Region[], sampleId?: string) => {
      controllers.current[slot]?.abort();
      const previousUrl = urls.current[slot];
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      const objectUrl = URL.createObjectURL(blob);
      urls.current[slot] = objectUrl;
      const creative: Creative = { id: newId(), filename, objectUrl, blob, source, sampleId };
      patchSlot(slot, { ...EMPTY_SLOT, creative, regions });
      void analyze(slot, creative);
    },
    [analyze, patchSlot],
  );

  const onFile = useCallback(
    (slot: SlotId, file: File) => {
      const problem = checkFileBeforeUpload(file);
      if (problem) {
        patchSlot(slot, { inputError: problem });
        return;
      }
      setCreative(slot, file, file.name, "upload", []);
    },
    [patchSlot, setCreative],
  );

  const onSample = useCallback(
    async (slot: SlotId, sample: Sample) => {
      try {
        const blob = await fetchSampleBlob(sample);
        setCreative(slot, blob, sample.filename, "sample", sampleRegions(sample), sample.id);
      } catch (err) {
        patchSlot(slot, { inputError: err instanceof Error ? err.message : String(err) });
      }
    },
    [patchSlot, setCreative],
  );

  const onClear = useCallback(
    (slot: SlotId) => {
      controllers.current[slot]?.abort();
      const url = urls.current[slot];
      if (url) URL.revokeObjectURL(url);
      delete urls.current[slot];
      patchSlot(slot, EMPTY_SLOT);
    },
    [patchSlot],
  );

  const addRegion = (slot: SlotId, label: RegionLabel, rect: NormRect) => {
    const region: Region = { id: newId(), label, rect };
    patchSlot(slot, (s) => ({ regions: [...s.regions, region], selectedId: region.id }));
  };
  const changeRegion = (slot: SlotId, region: Region) =>
    patchSlot(slot, (s) => ({ regions: s.regions.map((r) => (r.id === region.id ? region : r)) }));
  const deleteRegion = (slot: SlotId, id: string) =>
    patchSlot(slot, (s) => ({ regions: s.regions.filter((r) => r.id !== id), selectedId: null }));

  const derivedA = useMemo(() => derive(slots.A), [slots.A]);
  const derivedB = useMemo(() => derive(slots.B), [slots.B]);
  const derived: Record<SlotId, Derived> = { A: derivedA, B: derivedB };

  const comparison = useMemo(
    () => compareRegions(slots.A.regions, slots.B.regions, choices),
    [slots.A.regions, slots.B.regions, choices],
  );

  const onExport = () => {
    const slotExport = (id: SlotId) => {
      const s = slots[id];
      if (!s.creative) return undefined;
      return {
        filename: s.creative.filename,
        analysis: s.analysis.status === "done" ? s.analysis.analysis : null,
        regions: s.regions,
        scores: derived[id].scores,
      };
    };
    const both = slots.A.creative && slots.B.creative;
    downloadJson("focusframe-results.json", buildExport({ A: slotExport("A"), B: slotExport("B") }, both ? comparison : null));
  };

  return (
    <div className="workspace">
      <div className="toolbar">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            void onSample("A", SAMPLES[0]);
            void onSample("B", SAMPLES[1]);
            setChoices({});
          }}
        >
          Load example comparison
        </button>
        <label className="toggle">
          <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
          Show heatmaps
        </label>
        <label className="slider">
          <span>Heatmap opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(opacity * 100)}
            disabled={!showHeatmap}
            aria-valuetext={`${Math.round(opacity * 100)}%`}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          />
          <output>{Math.round(opacity * 100)}%</output>
        </label>
      </div>
      <p className="toolbar__hint">
        Choose a PNG/JPEG (up to 10 MiB) for each slot, or load the example. Images are sent to the
        local analysis API, are not stored, and disappear on refresh. Heatmap colours are scaled to each
        image&apos;s own maximum; use the numbers to compare.
      </p>

      <div className="slots">
        {SLOTS.map((slot) => (
          <AdSlot
            key={slot}
            slot={slot}
            creative={slots[slot].creative}
            analysis={slots[slot].analysis}
            inputError={slots[slot].inputError}
            samples={SAMPLES}
            regions={slots[slot].regions}
            scores={derived[slot].scores}
            peak={derived[slot].peak}
            imageSize={derived[slot].imageSize}
            scoringProblem={derived[slot].scoringProblem}
            selectedId={slots[slot].selectedId}
            showHeatmap={showHeatmap}
            opacity={opacity}
            onFile={(file) => onFile(slot, file)}
            onSample={(sample) => void onSample(slot, sample)}
            onRetry={() => {
              const creative = slots[slot].creative;
              if (creative) void analyze(slot, creative);
            }}
            onClear={() => onClear(slot)}
            onImageSize={(naturalSize) => patchSlot(slot, { naturalSize })}
            onAddRegion={(label, rect) => addRegion(slot, label, rect)}
            onChangeRegion={(region) => changeRegion(slot, region)}
            onDeleteRegion={(id) => deleteRegion(slot, id)}
            onSelect={(id) => patchSlot(slot, { selectedId: id })}
          />
        ))}
      </div>

      {(slots.A.creative || slots.B.creative) && (
        <ComparisonPanel
          regionsA={slots.A.regions}
          regionsB={slots.B.regions}
          comparison={comparison}
          scoresA={derivedA.scores}
          scoresB={derivedB.scores}
          onChoose={(aId, bId) => setChoices((c) => ({ ...c, [aId]: bId }))}
          onExport={onExport}
        />
      )}
    </div>
  );
}
