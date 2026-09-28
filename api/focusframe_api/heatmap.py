"""Render the model density as a transparent PNG overlay.

The overlay is a visualization of the same density used for scoring; region
scores never read these colours. Colour and alpha are scaled to this image's
maximum density, so colours are not comparable across images.
"""

from __future__ import annotations

import base64
import io

import numpy as np
from matplotlib import colormaps
from numpy.typing import NDArray
from PIL import Image

COLORMAP = "inferno"
ALPHA_GAMMA = 0.5
_LUT = (colormaps[COLORMAP](np.linspace(0.0, 1.0, 256))[:, :3] * 255).round().astype(np.uint8)


def render_heatmap_png(density: NDArray[np.floating]) -> bytes:
    d = np.asarray(density, dtype=np.float64)
    peak = d.max()
    scaled = d / peak if peak > 0 else np.zeros_like(d)
    index = np.clip((scaled * 255).round(), 0, 255).astype(np.uint8)
    rgba = np.empty((*d.shape, 4), dtype=np.uint8)
    rgba[..., :3] = _LUT[index]
    rgba[..., 3] = np.clip((scaled**ALPHA_GAMMA) * 255, 0, 255).round().astype(np.uint8)
    buffer = io.BytesIO()
    # A freshly constructed image carries no EXIF/text metadata from the upload.
    Image.fromarray(rgba, mode="RGBA").save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def to_data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")
