# Architecture decision records

ADR-001 to ADR-005 come from the project brief. Each one says whether the build kept the decision and records anything that changed while it was being implemented. ADR-006 onward cover decisions that the brief left open.

## ADR-001 — Static ads first

**Status:** kept.

**Decision:** support PNG and JPEG stills only. Video and animation need temporal models and are deferred.

**Implementation notes:**

- The API checks the file's magic bytes. If the declared type and the detected format disagree (for example, a JPEG labeled `image/png`), it returns `415`. Animated PNGs also return `415`.
- EXIF orientation is applied once. 16-bit greyscale is rescaled to 8 bits. Transparent pixels are composited over **white**, and the response reports `processing.alpha_composited_on_white`. White is an assumption about where the ad will be shown.
- Size limits:
  - The 10 MiB upload and 20 MP limits are kept.
  - The minimum side is 32 px.
  - The long-to-short side ratio is capped at **8.5:1**, which admits a 728×90 leaderboard and rejects narrower strips with `422`.
  - Pillow's decompression-bomb warning is treated as an error.

## ADR-002 — Pretrained spatial model

**Status:** kept, with a license caveat.

**Decision:** DeepGaze IIE behind `model_adapter.py`, which exposes `predict_attention(image) -> density`.

**Implementation notes:**

- Pinned to upstream commit `c7db17e2` and to `deepgaze2e.pth`, both verified by SHA-256.
- Inputs are always rescaled to a 1024 px long side using the MIT1003 center bias, following the upstream README.
- The upstream package requires OpenAI CLIP at import time, so CLIP is pinned as a dependency even though it is unused.
- Model construction downloads four backbone checkpoints the first time, which took 24 s on first run. After that, a load from cache took 2–4 s.
- **Change:** the upstream repository declares no license. The model is used for local, non-commercial evaluation only, and the weights are downloaded by the user rather than redistributed. See [model-and-license.md](model-and-license.md).
- The evaluation found a strong center prior and an edge artifact on featureless images (see [evaluation.md](evaluation.md)). The domain-mismatch risk this ADR anticipated is real, so the decision should be revisited before any claims about ads are made.

## ADR-003 — Manual regions first

**Status:** kept.

**Decision:** users mark the brand, headline, product, CTA, or custom regions as rectangles, either by dragging or by typing pixel coordinates. Every drawn region can also be edited numerically, and invalid values are rejected with a message that states the image size.

**Implementation notes:**

- Regions are stored normalized to `[0,1]`, so resizing the browser does not change them. This was verified at a 417 px display width.
- Scores use fractional cell overlap on the returned density grid, never the heatmap colors.
- **Addition — pairing rules:**
  - A non-custom label that appears exactly once in each ad is paired automatically.
  - Any other same-label case needs an explicit choice.
  - Custom regions are never paired automatically.
  - Only same-label regions can be paired, and the user can mark any region "not compared". Unmatched regions are listed separately.
- **Addition — orientation guard:** if the browser's decoded image size differs from the API's post-EXIF size, the UI hides the scores instead of misaligning them.

## ADR-004 — Synchronous local API

**Status:** kept. Measurements support it.

**Decision:** `POST /v1/analyses` returns the full analysis in the same request.

**Measurements:**

- Median inference for a 1200×628 ad is **0.55 s on an RTX 3060** and **1.33 s on a Ryzen 5 5600X CPU**.
- The worst tested case was a 20 MP JPEG: about 1.06 s end to end on the GPU, including decoding.
- This is fast enough for a synchronous request. The UI timeout is 120 s.

**Implementation notes:**

- **Change:** the model loads in a background thread at startup. `/health` reports `model_ready: false`, and analyses return `503 model_unavailable` until loading finishes, so the server starts serving immediately.
- Inference is serialized by a lock, so requests queue in the server. Add a job queue if concurrent use appears.

## ADR-005 — No persistent uploads in MVP

**Status:** kept.

**Decision:** uploads are read into memory, analyzed, and discarded. They are never written to disk or logged; access logs record only the method, path, request ID, and duration.

**Implementation notes:**

- The heatmap PNG is generated with no metadata.
- The browser keeps state in memory only, and nothing is written to `localStorage`.
- **Addition:** a "Download JSON" export covers the "export or capture a result" success criterion. It contains region geometry, scores, pairs, and the model version, but no image, heatmap, or density bytes.

## ADR-006 — Density grid encoding

**Decision:** the grid is float32 little-endian, base64, row-major from the top-left, with 128 cells on the long side and the image's aspect ratio (1200×628 becomes 128×67). It is built from the full-resolution density by fractional-overlap integration, so every model pixel's mass is split exactly among the cells it touches.

**Change from the spec example (150×79):**

- The response adds `density.layout` and a `sum` field. `sum` is the float32 sum and differs from 1 by less than 1e-9.
- The response adds heatmap metadata: `width`/`height` at model-input resolution, `color_scale: "relative-to-image-max"`, and `colormap`.
- The payload is about 129 KiB for a 1200×628 ad: 83 KiB of heatmap and 45 KiB of density. That is small enough to keep the data URL.

**Why 128:** the largest region-score difference between the grid and the full 1024×536 density was 0.063 percentage points on the sample regions.

## ADR-007 — One typed contract

**Decision:** the Pydantic models in `api/focusframe_api/schemas.py` are the source of truth.

- `python -m focusframe_api.contract` writes `contract/openapi.json`.
- `npm run gen:api` generates `web/src/lib/api/schema.gen.ts` from it.
- A pytest test and `npm run check:api` fail if either output drifts.
- Every response carries `schema_version`, and the client rejects a version it does not understand.

## ADR-008 — Synthetic, project-owned samples

**Decision:** the two bundled ads are drawn by `samples/generate_samples.py` for a fictional brand, using DejaVu fonts. The project owns them outright, and the preset regions are exact element bounding boxes rather than hand-traced ones.

**Consequence:** they are flat vector-style graphics, not photographs, which is a further domain shift from the model's training data. The evaluation uses them only as technical fixtures.
