export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

/** Client-side request timeout for one analysis. First requests on CPU can be slow. */
export const ANALYSIS_TIMEOUT_MS = Number(
  process.env.NEXT_PUBLIC_ANALYSIS_TIMEOUT_MS ?? 120_000,
);

/** Mirrors the server guardrails; the server remains the source of truth. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg"] as const;
