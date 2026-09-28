"""Measure properties used to set integration-test thresholds (prints, does not assert)."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from focusframe_api.config import Settings
from focusframe_api.model_adapter import DeepGazeIIEAdapter

ROOT = Path(__file__).resolve().parents[2]
settings = Settings.from_env()
model = DeepGazeIIEAdapter(settings.cache_dir, device=settings.device)
a = Image.open(ROOT / "web/public/samples/layout-a.png").convert("RGB")
b = Image.open(ROOT / "web/public/samples/layout-b.png").convert("RGB")

pb1 = model.predict_attention(b).density
pb2 = model.predict_attention(b).density
pa = model.predict_attention(a).density
pm = model.predict_attention(ImageOps.mirror(b)).density[:, ::-1]


def corr(x, y):
    return float(np.corrcoef(x.ravel(), y.ravel())[0, 1])


print("device", model.device)
print(
    "repeat max abs diff",
    float(np.abs(pb1 - pb2).max()),
    "rel",
    float(np.abs(pb1 - pb2).max() / pb1.max()),
)
print("mirror corr", corr(pb1, pm))
print("a vs b corr", corr(pa, pb1))
print("max/mean b", float(pb1.max() / pb1.mean()))
uniform_entropy = np.log(pb1.size)
entropy = float(-(pb1 * np.log(pb1)).sum())
print("entropy ratio", entropy / uniform_entropy)
