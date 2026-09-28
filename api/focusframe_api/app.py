"""FastAPI application: POST /v1/analyses and GET /health."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import SCHEMA_VERSION
from .config import Settings
from .density import encode_float32_le, grid_shape, integrate_to_grid
from .errors import ApiError
from .heatmap import COLORMAP, render_heatmap_png, to_data_url
from .imaging import MAX_UPLOAD_BYTES, decode_upload
from .model_adapter import (
    RESAMPLING,
    UPSTREAM_REPO,
    WEIGHTS_SHA256,
    AttentionModel,
    DeepGazeIIEAdapter,
)
from .schemas import (
    AnalysisResponse,
    DensityGrid,
    ErrorResponse,
    HealthResponse,
    Heatmap,
    ImageInfo,
    ModelInfo,
    Processing,
)

log = logging.getLogger("focusframe_api")

# Multipart framing overhead allowance on top of the 10 MiB file limit.
MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 256 * 1024

CITATION = (
    "Linardos, A., Kümmerer, M., Press, O., & Bethge, M. (2021). Calibrated prediction in and "
    "out-of-domain for state-of-the-art saliency modeling. arXiv:2105.12441"
)
LICENSE_NOTE = (
    "Upstream repository declares no license (no LICENSE file; MIT is commented out in setup.py). "
    "Used here for local, non-commercial evaluation only; see docs/model-and-license.md."
)

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": ErrorResponse} for status in (400, 413, 415, 422, 500, 503)
}


class RequestTooLarge(ApiError):
    def __init__(self) -> None:
        super().__init__(413, "payload_too_large", "The upload exceeds the 10 MiB limit.")


class RequestContextMiddleware:
    """Assigns a request ID and enforces the request body size limit while streaming."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append((b"x-request-id", request_id.encode()))
            await send(message)

        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > MAX_REQUEST_BYTES:
            response = error_response(RequestTooLarge(), request_id)
            await response(scope, receive, send_with_id)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > MAX_REQUEST_BYTES:
                    raise RequestTooLarge()
            return message

        started = time.perf_counter()
        await self.app(scope, limited_receive, send_with_id)
        log.info(
            "%s %s request_id=%s %.0fms",
            scope.get("method"),
            scope.get("path"),
            request_id,
            (time.perf_counter() - started) * 1000,
        )


def error_response(error: ApiError, request_id: str) -> JSONResponse:
    body = ErrorResponse(code=error.code, message=error.message, request_id=request_id)  # type: ignore[arg-type]
    return JSONResponse(body.model_dump(), status_code=error.status_code)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or str(uuid.uuid4())


class ModelHolder:
    """Loads the model in a background thread so /health responds during startup."""

    def __init__(self, loader: Callable[[], AttentionModel]) -> None:
        self._loader = loader
        self.model: AttentionModel | None = None
        self.error: str | None = None
        self._thread = threading.Thread(target=self._load, name="model-loader", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def wait(self, timeout: float | None = None) -> None:
        self._thread.join(timeout)

    def _load(self) -> None:
        try:
            self.model = self._loader()
        except Exception as exc:  # noqa: BLE001 - reported via /health and 503s
            self.error = str(exc)
            log.error("model failed to load: %s", exc)

    @property
    def loading(self) -> bool:
        return self._thread.is_alive()


def create_app(
    settings: Settings | None = None,
    model_loader: Callable[[], AttentionModel] | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    loader = model_loader or (
        lambda: DeepGazeIIEAdapter(settings.cache_dir, device=settings.device)
    )
    holder = ModelHolder(loader)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        holder.start()
        yield

    app = FastAPI(
        title="FocusFrame analysis API",
        version=SCHEMA_VERSION,
        lifespan=lifespan,
        description="Predicted visual attention (DeepGaze IIE) for static PNG/JPEG ads.",
    )
    app.state.model_holder = holder
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc, _request_id(request))

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        error = ApiError(
            400, "invalid_request", "Send multipart/form-data with an 'image' file field."
        )
        return error_response(error, _request_id(request))

    @app.exception_handler(StarletteHTTPException)
    async def handle_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if isinstance(exc.__cause__, ApiError):  # e.g. size limit hit while parsing the form
            return error_response(exc.__cause__, _request_id(request))
        if exc.status_code == 404:
            error = ApiError(404, "not_found", "Not found.")
        elif exc.status_code == 405:
            error = ApiError(405, "invalid_request", "Method not allowed.")
        else:
            error = ApiError(400, "invalid_request", "The request could not be processed.")
        return error_response(error, _request_id(request))

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", model_ready=holder.model is not None)

    @app.post(
        "/v1/analyses",
        response_model=AnalysisResponse,
        responses=ERROR_RESPONSES,
        summary="Predict visual attention for one PNG/JPEG image",
    )
    async def create_analysis(image: UploadFile = File(...)) -> AnalysisResponse:
        started = time.perf_counter()
        model = holder.model
        if model is None:
            message = (
                "The attention model is still loading; try again shortly."
                if holder.loading
                else "The attention model is unavailable on this server."
            )
            raise ApiError(503, "model_unavailable", message)

        data = await image.read(MAX_UPLOAD_BYTES + 1)
        await image.close()
        decoded = await run_in_threadpool(decode_upload, data, image.content_type)
        del data

        try:
            prediction = await run_in_threadpool(model.predict_attention, decoded.image)
            grid_w, grid_h = grid_shape(
                decoded.image.width, decoded.image.height, settings.grid_max_side
            )
            grid = integrate_to_grid(prediction.density, grid_w, grid_h).astype("<f4")
            heatmap_png = await run_in_threadpool(render_heatmap_png, prediction.density)
        except ApiError:
            raise
        except Exception:
            log.exception("inference failed")
            raise ApiError(
                500, "inference_failed", "The model failed to analyze this image."
            ) from None

        return AnalysisResponse(
            schema_version="1",
            analysis_id=str(uuid.uuid4()),
            created_at=datetime.now(timezone.utc).isoformat(),
            model=ModelInfo(
                name=model.name,
                version=model.version,
                weights_sha256=WEIGHTS_SHA256,
                source_url=UPSTREAM_REPO,
                citation=CITATION,
                license_note=LICENSE_NOTE,
            ),
            image=ImageInfo(width=decoded.image.width, height=decoded.image.height),
            density=DensityGrid(
                width=grid_w,
                height=grid_h,
                encoding="base64-float32-le",
                layout="row-major-top-left",
                data=encode_float32_le(grid),
                sum=float(np.sum(grid, dtype=np.float64)),
            ),
            heatmap=Heatmap(
                mime_type="image/png",
                data_url=to_data_url(heatmap_png),
                width=prediction.model_input_width,
                height=prediction.model_input_height,
                color_scale="relative-to-image-max",
                colormap=COLORMAP,
            ),
            processing=Processing(
                orientation_applied=decoded.orientation_applied,
                exif_orientation=decoded.exif_orientation,
                source_format=decoded.source_format,  # type: ignore[arg-type]
                source_mode=decoded.source_mode,
                alpha_composited_on_white=decoded.alpha_composited,
                model_input_width=prediction.model_input_width,
                model_input_height=prediction.model_input_height,
                resampling=RESAMPLING.name.lower(),
                centerbias=model.centerbias,
                device=model.device,
                inference_ms=round(prediction.inference_ms, 1),
                total_ms=round((time.perf_counter() - started) * 1000, 1),
            ),
        )

    return app
