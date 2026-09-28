"""Real DeepGaze IIE through the HTTP API. Skipped when weights have not been fetched.

Thresholds were set below values measured on 2026-09-28 (see docs/evaluation.md):
mirror correlation 0.981, layout A vs B correlation -0.016, peak/mean 18.6.
"""

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageOps

from focusframe_api.app import create_app
from focusframe_api.config import Settings
from focusframe_api.density import decode_float32_le
from focusframe_api.model_adapter import MODEL_VERSION, cache_paths
from focusframe_api.schemas import AnalysisResponse

from .conftest import SAMPLES_DIR, encode

SETTINGS = Settings.from_env()
pytestmark = [
    pytest.mark.model,
    pytest.mark.skipif(
        not all(p.exists() for p in cache_paths(SETTINGS.cache_dir)),
        reason="DeepGaze IIE weights not downloaded (python -m focusframe_api.fetch_weights)",
    ),
]


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app(SETTINGS)) as c:
        holder = c.app.state.model_holder
        holder.wait(300)
        assert holder.model is not None, holder.error
        yield c


def analyze(client: TestClient, data: bytes) -> tuple[AnalysisResponse, np.ndarray]:
    response = client.post("/v1/analyses", files={"image": ("ad.png", data, "image/png")})
    assert response.status_code == 200, response.text
    body = AnalysisResponse.model_validate(response.json())
    grid = decode_float32_le(body.density.data, body.density.width, body.density.height)
    return body, grid.astype(np.float64)


def corr(x: np.ndarray, y: np.ndarray) -> float:
    return float(np.corrcoef(x.ravel(), y.ravel())[0, 1])


def test_real_sample_produces_a_normalized_image_dependent_density(client):
    sample_b = (SAMPLES_DIR / "layout-b.png").read_bytes()
    body, grid = analyze(client, sample_b)

    assert body.model.name == "DeepGaze IIE" and body.model.version == MODEL_VERSION
    assert (body.image.width, body.image.height) == (1200, 628)
    assert (body.processing.model_input_width, body.processing.model_input_height) == (1024, 536)
    assert np.all(np.isfinite(grid)) and np.all(grid >= 0)
    assert grid.sum() == pytest.approx(1.0, abs=1e-5)
    assert grid.max() / grid.mean() > 5, "prediction should not be near-uniform"

    _, repeat = analyze(client, sample_b)
    np.testing.assert_allclose(repeat, grid, rtol=0, atol=1e-9)

    _, other_layout = analyze(client, (SAMPLES_DIR / "layout-a.png").read_bytes())
    assert corr(grid, other_layout) < 0.5, "different layouts should give different maps"


def test_mirrored_image_gives_mirrored_density(client):
    """Checks the image-to-grid coordinate mapping end to end with the real model."""
    image = Image.open(io.BytesIO((SAMPLES_DIR / "layout-b.png").read_bytes())).convert("RGB")
    _, grid = analyze(client, encode(image))
    _, mirrored = analyze(client, encode(ImageOps.mirror(image)))
    assert corr(grid, mirrored[:, ::-1]) > 0.95
