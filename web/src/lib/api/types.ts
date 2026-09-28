// Provisional contract (milestone 1). Replaced by types generated from the
// FastAPI OpenAPI schema in milestone 2.

export type AnalysisResponse = {
  schema_version: "1";
  analysis_id: string;
  model: { name: string; version: string };
  image: { width: number; height: number };
  density: {
    width: number;
    height: number;
    encoding: "base64-float32-le";
    data: string;
    sum: number;
  };
  heatmap: { mime_type: "image/png"; data_url: string };
  processing: {
    orientation_applied: boolean;
    model_input_width: number;
    model_input_height: number;
  };
};

export type ErrorResponse = {
  code: string;
  message: string;
  request_id: string;
};
