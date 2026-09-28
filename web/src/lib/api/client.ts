import { ANALYSIS_TIMEOUT_MS, API_BASE_URL } from "../config";
import type { AnalysisResponse, ErrorResponse } from "./types";

export class AnalysisError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(code: string, message: string, status: number | null, requestId: string | null) {
    super(message);
    this.name = "AnalysisError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ErrorResponse).code === "string" &&
    typeof (value as ErrorResponse).message === "string"
  );
}

/**
 * POST /v1/analyses. Rejects with AnalysisError for every failure mode
 * (network, timeout, caller abort, API error body, unexpected body).
 */
export async function requestAnalysis(
  image: Blob,
  filename: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AnalysisResponse> {
  const timeoutMs = options.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onCallerAbort);

  const body = new FormData();
  body.append("image", image, filename);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/v1/analyses`, {
      method: "POST",
      body,
      signal: controller.signal,
    });
  } catch {
    if (timedOut) {
      throw new AnalysisError(
        "timeout",
        `The analysis did not finish within ${Math.round(timeoutMs / 1000)} seconds.`,
        null,
        null,
      );
    }
    if (options.signal?.aborted) {
      throw new AnalysisError("aborted", "The analysis was cancelled.", null, null);
    }
    throw new AnalysisError(
      "network_error",
      `Could not reach the analysis API at ${API_BASE_URL}. Is it running?`,
      null,
      null,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AnalysisError(
      "invalid_response",
      `The API returned an unreadable response (HTTP ${response.status}).`,
      response.status,
      response.headers.get("x-request-id"),
    );
  }

  if (!response.ok) {
    if (isErrorResponse(payload)) {
      throw new AnalysisError(payload.code, payload.message, response.status, payload.request_id);
    }
    throw new AnalysisError(
      "http_error",
      `The API returned HTTP ${response.status}.`,
      response.status,
      response.headers.get("x-request-id"),
    );
  }

  const analysis = payload as AnalysisResponse;
  if (analysis?.schema_version !== "1") {
    throw new AnalysisError(
      "schema_mismatch",
      "The API response uses an unsupported schema version.",
      response.status,
      response.headers.get("x-request-id"),
    );
  }
  return analysis;
}
