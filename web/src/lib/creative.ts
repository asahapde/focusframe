import type { AnalysisResponse } from "./api/types";

export type SlotId = "A" | "B";

export type Creative = {
  id: string;
  filename: string;
  /** Object URL for the selected bytes. Revoke when the creative is replaced. */
  objectUrl: string;
  blob: Blob;
  source: "upload" | "sample";
  sampleId?: string;
};

export type AnalysisState =
  | { status: "idle" }
  | { status: "loading"; startedAt: number }
  | { status: "error"; code: string; message: string; requestId: string | null }
  | { status: "done"; analysis: AnalysisResponse; receivedAt: number };

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
