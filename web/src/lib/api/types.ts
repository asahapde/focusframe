// Stable names for the generated contract types. Regenerate with `npm run gen:api`
// after `python -m focusframe_api.contract` updates contract/openapi.json.
import type { components } from "./schema.gen";

type Schemas = components["schemas"];

export type AnalysisResponse = Schemas["AnalysisResponse"];
export type DensityGrid = Schemas["DensityGrid"];
export type ModelInfo = Schemas["ModelInfo"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type HealthResponse = Schemas["HealthResponse"];
