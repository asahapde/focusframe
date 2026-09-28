"""Download and verify the pinned DeepGaze IIE weights and center bias.

    python -m focusframe_api.fetch_weights

Downloads go to FOCUSFRAME_MODEL_CACHE (default api/.model-cache). The files
are not redistributed with this repository; they come from the upstream
GitHub releases (and, via upstream code, ImageNet backbone checkpoints).
"""

from __future__ import annotations

import logging
import sys

from .config import Settings
from .model_adapter import MODEL_VERSION, DeepGazeIIEAdapter, ModelUnavailable, cache_paths


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    settings = Settings.from_env()
    try:
        adapter = DeepGazeIIEAdapter(settings.cache_dir, device="cpu", allow_download=True)
    except ModelUnavailable as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    weights, centerbias = cache_paths(settings.cache_dir)
    print(f"verified {adapter.name} {MODEL_VERSION}")
    print(f"  weights:    {weights}")
    print(f"  centerbias: {centerbias}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
