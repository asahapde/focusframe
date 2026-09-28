from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    cache_dir: Path
    device: str
    cors_origins: tuple[str, ...]
    grid_max_side: int

    @classmethod
    def from_env(cls) -> Settings:
        origins = os.environ.get(
            "FOCUSFRAME_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        )
        return cls(
            cache_dir=Path(os.environ.get("FOCUSFRAME_MODEL_CACHE", API_ROOT / ".model-cache")),
            device=os.environ.get("FOCUSFRAME_DEVICE", "auto"),
            cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            grid_max_side=int(os.environ.get("FOCUSFRAME_GRID_MAX_SIDE", "128")),
        )
