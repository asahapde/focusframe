"""Export the OpenAPI document that the web client's TypeScript types are generated from.

python -m focusframe_api.contract          # rewrite contract/openapi.json
"""

from __future__ import annotations

import json
from pathlib import Path

from .app import create_app
from .config import Settings

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contract" / "openapi.json"


def _no_model():  # the schema does not depend on the model; never load it here
    raise RuntimeError("model not loaded while exporting the contract")


def openapi_document() -> str:
    settings = Settings(cache_dir=Path("."), device="cpu", cors_origins=(), grid_max_side=128)
    schema = create_app(settings, model_loader=_no_model).openapi()
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> None:
    CONTRACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONTRACT_PATH.write_text(openapi_document(), encoding="utf-8", newline="\n")
    print(f"wrote {CONTRACT_PATH}")


if __name__ == "__main__":
    main()
