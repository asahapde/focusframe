"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AnalysisError, requestAnalysis } from "@/lib/api/client";
import type { AnalysisState, Creative, SlotId } from "@/lib/creative";
import { newId } from "@/lib/creative";
import { checkFileBeforeUpload } from "@/lib/files";
import { SAMPLES, fetchSampleBlob, type Sample } from "@/lib/samples";

import { AdSlot } from "./AdSlot";

type SlotState = {
  creative: Creative | null;
  analysis: AnalysisState;
  inputError: string | null;
};

const EMPTY_SLOT: SlotState = { creative: null, analysis: { status: "idle" }, inputError: null };
const SLOTS: SlotId[] = ["A", "B"];

export function Workspace() {
  const [slots, setSlots] = useState<Record<SlotId, SlotState>>({ A: EMPTY_SLOT, B: EMPTY_SLOT });
  const controllers = useRef<Partial<Record<SlotId, AbortController>>>({});
  const urls = useRef<Partial<Record<SlotId, string>>>({});

  const patchSlot = useCallback((slot: SlotId, patch: Partial<SlotState>) => {
    setSlots((prev) => ({ ...prev, [slot]: { ...prev[slot], ...patch } }));
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
        const analysis = await requestAnalysis(creative.blob, creative.filename, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        patchSlot(slot, { analysis: { status: "done", analysis, receivedAt: Date.now() } });
      } catch (err) {
        if (controller.signal.aborted) return;
        const e =
          err instanceof AnalysisError
            ? err
            : new AnalysisError("unexpected", "Something went wrong during analysis.", null, null);
        patchSlot(slot, {
          analysis: { status: "error", code: e.code, message: e.message, requestId: e.requestId },
        });
      }
    },
    [patchSlot],
  );

  const setCreative = useCallback(
    (slot: SlotId, blob: Blob, filename: string, source: Creative["source"], sampleId?: string) => {
      controllers.current[slot]?.abort();
      const previousUrl = urls.current[slot];
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      const objectUrl = URL.createObjectURL(blob);
      urls.current[slot] = objectUrl;
      const creative: Creative = { id: newId(), filename, objectUrl, blob, source, sampleId };
      patchSlot(slot, { creative, inputError: null, analysis: { status: "idle" } });
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
      setCreative(slot, file, file.name, "upload");
    },
    [patchSlot, setCreative],
  );

  const onSample = useCallback(
    async (slot: SlotId, sample: Sample) => {
      try {
        const blob = await fetchSampleBlob(sample);
        setCreative(slot, blob, sample.filename, "sample", sample.id);
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

  const loadExampleComparison = useCallback(() => {
    void onSample("A", SAMPLES[0]);
    void onSample("B", SAMPLES[1]);
  }, [onSample]);

  return (
    <div className="workspace">
      <div className="toolbar">
        <button type="button" className="button button--primary" onClick={loadExampleComparison}>
          Load example comparison
        </button>
        <p className="toolbar__hint">
          Or choose your own PNG/JPEG (up to 10 MiB) for each slot. Images are sent to the local
          analysis API and are not stored.
        </p>
      </div>

      <div className="slots">
        {SLOTS.map((slot) => (
          <AdSlot
            key={slot}
            slot={slot}
            creative={slots[slot].creative}
            analysis={slots[slot].analysis}
            inputError={slots[slot].inputError}
            samples={SAMPLES}
            onFile={(file) => onFile(slot, file)}
            onSample={(sample) => void onSample(slot, sample)}
            onRetry={() => {
              const creative = slots[slot].creative;
              if (creative) void analyze(slot, creative);
            }}
            onClear={() => onClear(slot)}
          />
        ))}
      </div>
    </div>
  );
}
