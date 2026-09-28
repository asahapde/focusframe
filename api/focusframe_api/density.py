"""Probability-density math shared by the API: normalization, grid integration, encoding.

Coordinate convention: a density array of shape (rows, cols) covers the whole
image. Pixel/cell (r, c) spans the normalized rectangle
[c/cols, (c+1)/cols) x [r/rows, (r+1)/rows). Because every array in the
pipeline (model input, returned grid) covers the full image, normalized
coordinates are the common frame between them and the original image.
"""

from __future__ import annotations

import base64

import numpy as np
from numpy.typing import NDArray
from scipy.special import logsumexp

FloatArray = NDArray[np.float64]


def normalize_log_density(log_density: NDArray[np.floating]) -> FloatArray:
    """Convert an (unnormalized) log density to a probability map that sums to 1.

    Uses log-sum-exp so very negative log values do not underflow to all zeros.
    """
    values = np.asarray(log_density, dtype=np.float64)
    if values.ndim != 2 or values.size == 0:
        raise ValueError("log density must be a non-empty 2-D array")
    if not np.all(np.isfinite(values)):
        raise ValueError("log density contains non-finite values")
    density = np.exp(values - logsumexp(values))
    return density / density.sum()


def grid_shape(width: int, height: int, max_side: int) -> tuple[int, int]:
    """(grid_width, grid_height) with the longer side == max_side and aspect preserved."""
    if width <= 0 or height <= 0 or max_side <= 0:
        raise ValueError("dimensions must be positive")
    if width >= height:
        return max_side, max(1, round(max_side * height / width))
    return max(1, round(max_side * width / height)), max_side


def overlap_matrix(n_src: int, n_dst: int) -> FloatArray:
    """Matrix M (n_dst x n_src) where M[i, j] is the fraction of source bin j that
    lies inside destination bin i, with both binnings spanning [0, 1].

    Each column sums to 1, so M @ v conserves total mass exactly.
    """
    src_edges = np.linspace(0.0, 1.0, n_src + 1)
    dst_edges = np.linspace(0.0, 1.0, n_dst + 1)
    lo = np.maximum.outer(dst_edges[:-1], src_edges[:-1])
    hi = np.minimum.outer(dst_edges[1:], src_edges[1:])
    overlap = np.clip(hi - lo, 0.0, None)
    return overlap * n_src  # divide by source bin width (1 / n_src)


def integrate_to_grid(
    density: NDArray[np.floating], grid_width: int, grid_height: int
) -> FloatArray:
    """Area-integrate a density map onto a coarser (or finer) grid covering the same image.

    Source pixels that straddle a grid-cell boundary are split by fractional
    overlap, assuming density is uniform within each source pixel. The result
    is renormalized to sum to exactly 1 (in float64) after integration.
    """
    d = np.asarray(density, dtype=np.float64)
    rows = overlap_matrix(d.shape[0], grid_height)
    cols = overlap_matrix(d.shape[1], grid_width)
    grid = rows @ d @ cols.T
    total = grid.sum()
    if not np.isfinite(total) or total <= 0:
        raise ValueError("density has no positive mass")
    return grid / total


def encode_float32_le(values: NDArray[np.floating]) -> str:
    """Row-major, little-endian float32, base64-encoded."""
    return base64.b64encode(np.ascontiguousarray(values, dtype="<f4").tobytes()).decode("ascii")


def decode_float32_le(data: str, width: int, height: int) -> NDArray[np.float32]:
    raw = np.frombuffer(base64.b64decode(data), dtype="<f4")
    if raw.size != width * height:
        raise ValueError("decoded length does not match grid dimensions")
    return raw.reshape(height, width)
