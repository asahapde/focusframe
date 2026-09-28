"""HTTP contract tests with a stub model (validation, errors, grid mapping, CORS)."""

import base64
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from focusframe_api.app import MAX_REQUEST_BYTES, create_app
from focusframe_api.config import Settings
from focusframe_api.density import decode_float32_le
from focusframe_api.schemas import AnalysisResponse

from .conftest import QuadrantStubModel, encode

SETTINGS = Settings(
    cache_dir=None,  # type: ignore[arg-type]
    device="cpu",
    cors_origins=("http://localhost:3000",),
    grid_max_side=128,
)


def make_client(loader) -> TestClient:
    client = TestClient(create_app(SETTINGS, model_loader=loader))
    client.__enter__()
    client.app.state.model_holder.wait(5)
    return client


@pytest.fixture
def client():
    c = make_client(QuadrantStubModel)
    yield c
    c.__exit__(None, None, None)


def post_image(client: TestClient, data: bytes, mime: str = "image/png", **kwargs):
    return client.post("/v1/analyses", files={"image": ("ad.png", data, mime)}, **kwargs)


def test_successful_analysis_matches_contract_and_maps_grid_to_image(client, sample_png):
    response = post_image(client, sample_png)
    assert response.status_code == 200
    body = AnalysisResponse.model_validate(response.json())
    assert (body.image.width, body.image.height) == (1200, 628)
    assert (body.density.width, body.density.height) == (128, 67)

    grid = decode_float32_le(body.density.data, body.density.width, body.density.height)
    assert float(grid.sum(dtype=np.float64)) == pytest.approx(1.0, abs=1e-5)
    assert body.density.sum == pytest.approx(float(grid.sum(dtype=np.float64)))
    # The stub puts all mass in the top-left quadrant of the model input (1024x536):
    # columns [0, 512) = x in [0, 0.5); rows [0, 268) = y in [0, 0.5).
    assert float(grid[:34, :64].sum(dtype=np.float64)) == pytest.approx(1.0, abs=1e-5)

    header, payload = body.heatmap.data_url.split(",", 1)
    assert header == "data:image/png;base64"
    heatmap = Image.open(io.BytesIO(base64.b64decode(payload)))
    assert heatmap.size == (body.processing.model_input_width, body.processing.model_input_height)
    assert heatmap.mode == "RGBA"
    assert not heatmap.info.get("exif")


def test_errors_share_one_shape_and_echo_request_id(client):
    response = post_image(client, b"not an image")
    assert response.status_code == 415
    body = response.json()
    assert set(body) == {"code", "message", "request_id"}
    assert body["request_id"] == response.headers["x-request-id"]


def test_missing_image_field_is_a_bad_request(client):
    response = client.post("/v1/analyses", files={"file": ("a.png", b"x", "image/png")})
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"


def test_request_larger_than_limit_is_rejected_before_parsing(client):
    data = b"\0" * (MAX_REQUEST_BYTES + 1)
    response = post_image(client, data)
    assert response.status_code == 413
    assert response.json()["code"] == "payload_too_large"


def test_model_load_failure_returns_503_and_health_reports_not_ready():
    def failing_loader():
        raise RuntimeError("weights missing")

    client = make_client(failing_loader)
    try:
        assert client.get("/health").json() == {"status": "ok", "model_ready": False}
        png = encode(Image.new("RGB", (64, 64)))
        response = post_image(client, png)
        assert response.status_code == 503
        assert response.json()["code"] == "model_unavailable"
        assert "weights missing" not in response.text
    finally:
        client.__exit__(None, None, None)


def test_inference_exception_is_500_without_internals():
    class Exploding(QuadrantStubModel):
        def predict_attention(self, image):
            raise RuntimeError("CUDA out of memory at /secret/path")

    client = make_client(Exploding)
    try:
        response = post_image(client, encode(Image.new("RGB", (64, 64))))
        assert response.status_code == 500
        assert response.json()["code"] == "inference_failed"
        assert "secret" not in response.text
    finally:
        client.__exit__(None, None, None)


def test_cors_allows_only_configured_origins(client):
    preflight = {"Access-Control-Request-Method": "POST"}
    ok = client.options("/v1/analyses", headers={"Origin": "http://localhost:3000", **preflight})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = client.options("/v1/analyses", headers={"Origin": "http://evil.example", **preflight})
    assert "access-control-allow-origin" not in bad.headers
