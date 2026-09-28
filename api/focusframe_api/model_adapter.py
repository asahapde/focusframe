"""DeepGaze IIE adapter: the only module that knows about the model.

Follows the upstream usage instructions (github.com/matthias-k/DeepGaze,
README "DeepGaze IIE"): an RGB uint8-range tensor in (N, 3, H, W), plus the
MIT1003 center-bias log density resized to the input with nearest-neighbour
zoom and renormalized with logsumexp. Output is a log density over the model
input pixels.

Pinned artifacts (verified by SHA-256 before the model is used):
- code: deepgaze_pytorch at commit c7db17e2 (installed from git)
- weights: deepgaze2e.pth from release v1.0.0
- center bias: centerbias_mit1003.npy from release v1.0.0
Upstream construction also downloads ImageNet backbone weights; they are
overwritten by deepgaze2e.pth, so only that file determines the predictions.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from .density import normalize_log_density

log = logging.getLogger(__name__)

MODEL_NAME = "DeepGaze IIE"
UPSTREAM_REPO = "https://github.com/matthias-k/DeepGaze"
UPSTREAM_COMMIT = "c7db17e2d1d7ea6468ffdee2cfaddf141095dcff"
WEIGHTS_URL = "https://github.com/matthias-k/DeepGaze/releases/download/v1.0.0/deepgaze2e.pth"
WEIGHTS_FILENAME = "deepgaze2e.pth"
WEIGHTS_SHA256 = "49b65724184f43a2b60426c29c12fd2b743b47ad9eb3435d3dd28e50ea4e2585"
CENTERBIAS_URL = (
    "https://github.com/matthias-k/DeepGaze/releases/download/v1.0.0/centerbias_mit1003.npy"
)
CENTERBIAS_FILENAME = "centerbias_mit1003.npy"
CENTERBIAS_SHA256 = "051645b7da47884c138e81f28a4afbadd99b6c3262eaf086434a9626e3578be9"
MODEL_VERSION = (
    f"deepgaze_pytorch@{UPSTREAM_COMMIT[:8]}+deepgaze2e.pth:sha256-{WEIGHTS_SHA256[:12]}"
)

# MIT1003 images are mostly 1024 px on the longer side at ~35 px/degree; the
# upstream notes say inputs may need rescaling to match. We always rescale so
# the longer side is 1024 px (up or down) for reproducibility.
MODEL_INPUT_LONG_SIDE = 1024
RESAMPLING = Image.Resampling.LANCZOS


@dataclass(frozen=True)
class AttentionPrediction:
    density: NDArray[np.float64]  # (model_input_height, model_input_width), sums to 1
    model_input_width: int
    model_input_height: int
    inference_ms: float


class AttentionModel(Protocol):
    name: str
    version: str
    device: str
    centerbias: str

    def predict_attention(self, image: Image.Image) -> AttentionPrediction: ...


def model_input_size(
    width: int, height: int, long_side: int = MODEL_INPUT_LONG_SIDE
) -> tuple[int, int]:
    """Aspect-preserving (width, height) whose longer side equals long_side."""
    scale = long_side / max(width, height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def resize_centerbias(
    template: NDArray[np.floating], height: int, width: int
) -> NDArray[np.float64]:
    """Upstream recipe: nearest-neighbour zoom of the log-density template, then renormalize."""
    from scipy.ndimage import zoom
    from scipy.special import logsumexp

    t = np.asarray(template, dtype=np.float64)
    resized = zoom(t, (height / t.shape[0], width / t.shape[1]), order=0, mode="nearest")
    if resized.shape != (height, width):  # zoom rounds output size; guard exactness
        raise ValueError(f"center bias resize produced {resized.shape}, expected {(height, width)}")
    return resized - logsumexp(resized)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cache_paths(cache_dir: Path) -> tuple[Path, Path]:
    torch_home = cache_dir / "torch"
    return (
        torch_home / "hub" / "checkpoints" / WEIGHTS_FILENAME,
        cache_dir / "deepgaze" / CENTERBIAS_FILENAME,
    )


class ModelUnavailable(RuntimeError):
    pass


class DeepGazeIIEAdapter:
    name = MODEL_NAME
    version = MODEL_VERSION
    centerbias = "MIT1003 (upstream release v1.0.0)"

    def __init__(self, cache_dir: Path, device: str = "auto", allow_download: bool = False) -> None:
        import torch

        self._torch = torch
        self.cache_dir = cache_dir
        weights_path, centerbias_path = cache_paths(cache_dir)
        os.environ["TORCH_HOME"] = str(cache_dir / "torch")

        if not allow_download:
            missing = [p for p in (weights_path, centerbias_path) if not p.exists()]
            if missing:
                raise ModelUnavailable(
                    "Model files are missing; run `python -m focusframe_api.fetch_weights` first."
                )
        else:
            centerbias_path.parent.mkdir(parents=True, exist_ok=True)
            if not centerbias_path.exists():
                torch.hub.download_url_to_file(CENTERBIAS_URL, str(centerbias_path))

        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device

        # Deterministic kernels so the same image and device give the same output.
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True

        import deepgaze_pytorch

        started = time.perf_counter()
        if weights_path.exists():
            self._verify(weights_path, centerbias_path)
            model = deepgaze_pytorch.DeepGazeIIE(pretrained=True)
        else:
            model = deepgaze_pytorch.DeepGazeIIE(pretrained=True)  # downloads weights
            self._verify(weights_path, centerbias_path)
        self._model = model.to(device).eval()
        self._centerbias_template = np.load(centerbias_path)
        self._lock = threading.Lock()
        log.info("DeepGaze IIE ready on %s in %.1fs", device, time.perf_counter() - started)

    @staticmethod
    def _verify(weights_path: Path, centerbias_path: Path) -> None:
        for path, expected in (
            (weights_path, WEIGHTS_SHA256),
            (centerbias_path, CENTERBIAS_SHA256),
        ):
            actual = sha256_file(path)
            if actual != expected:
                raise ModelUnavailable(f"{path.name} checksum mismatch (got {actual[:12]}...)")

    def predict_attention(self, image: Image.Image) -> AttentionPrediction:
        """Predict a fixation density for an RGB image. Output covers the full image."""
        if image.mode != "RGB":
            raise ValueError("expected an RGB image")
        torch = self._torch
        width, height = model_input_size(*image.size)
        resized = (
            image if image.size == (width, height) else image.resize((width, height), RESAMPLING)
        )
        pixels = np.asarray(resized, dtype=np.float32).transpose(2, 0, 1)[None]
        centerbias = resize_centerbias(self._centerbias_template, height, width)

        with self._lock:
            started = time.perf_counter()
            with torch.inference_mode():
                x = torch.from_numpy(np.ascontiguousarray(pixels)).to(self.device)
                c = torch.from_numpy(centerbias[None].astype(np.float32)).to(self.device)
                log_density = self._model(x, c)[0, 0].double().cpu().numpy()
            elapsed_ms = (time.perf_counter() - started) * 1000

        return AttentionPrediction(
            density=normalize_log_density(log_density),
            model_input_width=width,
            model_input_height=height,
            inference_ms=elapsed_ms,
        )
