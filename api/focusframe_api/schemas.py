"""Typed API contract. The web client's types are generated from this via OpenAPI."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ModelInfo(BaseModel):
    name: str = Field(description="Model family, e.g. 'DeepGaze IIE'.")
    version: str = Field(description="Pinned code commit and weights hash identifier.")
    weights_sha256: str
    source_url: str
    citation: str
    license_note: str


class ImageInfo(BaseModel):
    width: int = Field(description="Width in pixels after EXIF orientation was applied.")
    height: int = Field(description="Height in pixels after EXIF orientation was applied.")


class DensityGrid(BaseModel):
    width: int = Field(description="Grid columns. Column c covers x in [c/width, (c+1)/width).")
    height: int = Field(description="Grid rows. Row r covers y in [r/height, (r+1)/height).")
    encoding: Literal["base64-float32-le"]
    layout: Literal["row-major-top-left"]
    data: str = Field(description="Base64 of width*height little-endian float32 probabilities.")
    sum: float = Field(description="Sum of the decoded float32 values (1 up to float32 rounding).")


class Heatmap(BaseModel):
    mime_type: Literal["image/png"]
    data_url: str
    width: int
    height: int
    color_scale: Literal["relative-to-image-max"]
    colormap: str


class Processing(BaseModel):
    orientation_applied: bool
    exif_orientation: int | None
    source_format: Literal["PNG", "JPEG"]
    source_mode: str
    alpha_composited_on_white: bool
    model_input_width: int
    model_input_height: int
    resampling: str
    centerbias: str
    device: str
    inference_ms: float
    total_ms: float


class AnalysisResponse(BaseModel):
    schema_version: Literal["1"]
    analysis_id: str
    created_at: str = Field(description="UTC ISO 8601 timestamp.")
    model: ModelInfo
    image: ImageInfo
    density: DensityGrid
    heatmap: Heatmap
    processing: Processing


ErrorCode = Literal[
    "invalid_request",
    "invalid_image",
    "payload_too_large",
    "unsupported_media_type",
    "invalid_dimensions",
    "model_unavailable",
    "inference_failed",
    "internal_error",
    "not_found",
]


class ErrorResponse(BaseModel):
    code: ErrorCode
    message: str
    request_id: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    model_ready: bool
