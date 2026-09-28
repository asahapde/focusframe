from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from focusframe_api.model_adapter import AttentionPrediction, model_input_size

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLES_DIR = REPO_ROOT / "web" / "public" / "samples"


def encode(image: Image.Image, fmt: str = "PNG", **save_kwargs) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **save_kwargs)
    return buffer.getvalue()


class QuadrantStubModel:
    """HTTP-contract test double; never used by the application.

    Puts all probability mass in the top-left quadrant of the model input so
    tests can check that the API maps it to the top-left of the returned grid.
    """

    name = "stub"
    version = "stub-0"
    device = "cpu"
    centerbias = "none"

    def predict_attention(self, image: Image.Image) -> AttentionPrediction:
        width, height = model_input_size(*image.size)
        density = np.zeros((height, width))
        density[: height // 2, : width // 2] = 1.0
        density /= density.sum()
        return AttentionPrediction(density, width, height, inference_ms=0.0)


@pytest.fixture
def sample_png() -> bytes:
    return (SAMPLES_DIR / "layout-b.png").read_bytes()
