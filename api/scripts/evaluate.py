"""Offline technical evaluation of the DeepGaze IIE integration.

    api/.venv/Scripts/python api/scripts/evaluate.py

Writes docs/evaluation/results.json and overlay figures to docs/evaluation/.
Every number in docs/evaluation.md comes from a run of this script.
"""

from __future__ import annotations

import importlib.util
import io
import json
import platform
import statistics
import sys
import threading
import time
from pathlib import Path

import numpy as np
import psutil
import torch
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageOps

from focusframe_api.app import create_app
from focusframe_api.config import Settings
from focusframe_api.density import grid_shape, integrate_to_grid
from focusframe_api.heatmap import render_heatmap_png
from focusframe_api.model_adapter import MODEL_VERSION, DeepGazeIIEAdapter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "evaluation"
SAMPLES = json.loads((ROOT / "web/src/data/samples.json").read_text(encoding="utf-8"))["samples"]
spec = importlib.util.spec_from_file_location("gen", ROOT / "samples/generate_samples.py")
gen = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
sys.modules["gen"] = gen
spec.loader.exec_module(gen)  # type: ignore[union-attr]

settings = Settings.from_env()


def load(sample_id: str) -> Image.Image:
    return Image.open(ROOT / f"web/public/samples/{sample_id}.png").convert("RGB")


def regions(sample_id: str) -> dict[str, dict[str, float]]:
    s = next(s for s in SAMPLES if s["id"] == sample_id)
    return {r["label"]: r["rect"] for r in s["regions"]}


def axis_weights(n: int, lo: float, hi: float) -> np.ndarray:
    edges = np.linspace(0, 1, n + 1)
    return np.clip(np.minimum(edges[1:], hi) - np.maximum(edges[:-1], lo), 0, None) * n


def rect_mass(density: np.ndarray, rect: dict[str, float]) -> float:
    """Fractional-overlap mass at any resolution (same rule as web/src/lib/scoring.ts)."""
    wy = axis_weights(density.shape[0], rect["y"], rect["y"] + rect["height"])
    wx = axis_weights(density.shape[1], rect["x"], rect["x"] + rect["width"])
    return float(wy @ density @ wx / density.sum())


def score(density: np.ndarray, rect: dict[str, float]) -> dict[str, float]:
    area = rect["width"] * rect["height"]
    mass = rect_mass(density, rect)
    return {"area": round(area, 4), "attention": round(mass, 4), "lift": round(mass / area, 3)}


def grid_of(density: np.ndarray, image: Image.Image) -> np.ndarray:
    gw, gh = grid_shape(image.width, image.height, settings.grid_max_side)
    return integrate_to_grid(density, gw, gh).astype("<f4").astype(np.float64)


def peak_xy(density: np.ndarray) -> list[float]:
    row, col = np.unravel_index(density.argmax(), density.shape)
    return [round((col + 0.5) / density.shape[1], 3), round((row + 0.5) / density.shape[0], 3)]


def corr(a: np.ndarray, b: np.ndarray) -> float:
    return round(float(np.corrcoef(a.ravel(), b.ravel())[0, 1]), 4)


def figure(name: str, image: Image.Image, density: np.ndarray, rects: dict[str, dict]) -> str:
    h, w = density.shape
    base = image.resize((w, h), Image.Resampling.LANCZOS).convert("RGBA")
    heat = Image.open(io.BytesIO(render_heatmap_png(density)))
    heat.putalpha(heat.getchannel("A").point(lambda a: int(a * 0.75)))
    out = Image.alpha_composite(base, heat)
    draw = ImageDraw.Draw(out)
    for rect in rects.values():
        x0, y0 = rect["x"] * w, rect["y"] * h
        draw.rectangle(
            [x0, y0, x0 + rect["width"] * w, y0 + rect["height"] * h],
            outline=(0, 200, 255, 255),
            width=3,
        )
    out = out.convert("RGB")
    out.thumbnail((640, 640), Image.Resampling.LANCZOS)
    path = OUT / f"{name}.png"
    out.save(path, optimize=True)
    return str(path.relative_to(ROOT)).replace("\\", "/")


class RssSampler:
    def __init__(self) -> None:
        self.proc = psutil.Process()
        self.peak = 0
        self._stop = threading.Event()

    def __enter__(self):
        self.peak = self.proc.memory_info().rss
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()
        return self

    def _run(self) -> None:
        while not self._stop.is_set():
            self.peak = max(self.peak, self.proc.memory_info().rss)
            time.sleep(0.01)

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._t.join()


def time_inference(model, image: Image.Image, runs: int, device: str) -> dict:
    model.predict_attention(image)  # warm-up for this input size
    times, peak_cuda, peak_rss = [], 0, 0
    for _ in range(runs):
        if device == "cuda":
            torch.cuda.reset_peak_memory_stats()
        with RssSampler() as rss:
            pred = model.predict_attention(image)
        times.append(pred.inference_ms)
        peak_rss = max(peak_rss, rss.peak)
        if device == "cuda":
            peak_cuda = max(peak_cuda, torch.cuda.max_memory_allocated())
    return {
        "model_input": [pred.model_input_width, pred.model_input_height],
        "median_ms": round(statistics.median(times), 1),
        "min_ms": round(min(times), 1),
        "max_ms": round(max(times), 1),
        "runs": runs,
        "peak_cuda_mib": round(peak_cuda / 2**20) if device == "cuda" else None,
        "peak_process_rss_mib": round(peak_rss / 2**20),
    }


def dense_text_variant() -> tuple[Image.Image, dict]:
    img, _ = gen.variant_b()
    d = ImageDraw.Draw(img)
    f = gen.font(13)
    box = None
    for i in range(7):
        line = "Offer valid on orders over $40. Terms apply. See site for details and exclusions."
        b = gen.text_box(d, (560, 470 + i * 18), line, f, (70, 80, 88))
        box = b if box is None else gen.union(box, b)
    return img, {"custom": gen.normalized(box, img.size)}


def face_variant() -> tuple[Image.Image, dict]:
    img, _ = gen.variant_b()
    d = ImageDraw.Draw(img)
    cx, cy, r = 1040, 500, 70
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(240, 200, 170), outline=(60, 40, 30), width=3)
    for ex in (cx - 25, cx + 25):
        d.ellipse([ex - 9, cy - 22, ex + 9, cy - 4], fill=(30, 30, 30))
    d.arc([cx - 32, cy - 5, cx + 32, cy + 40], 20, 160, fill=(120, 40, 40), width=4)
    box = (cx - r, cy - r, cx + r, cy + r)
    return img, {"custom": gen.normalized(box, img.size)}


def letterbox(image: Image.Image) -> tuple[Image.Image, float]:
    side = max(image.size)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    pad = (side - image.height) // 2
    canvas.paste(image, (0, pad))
    return canvas, pad


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    results: dict = {
        "run_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model_version": MODEL_VERSION,
        "environment": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "os": platform.platform(),
            "cpu": platform.processor(),
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "cpu_threads": torch.get_num_threads(),
        },
    }
    t0 = time.perf_counter()
    gpu = DeepGazeIIEAdapter(settings.cache_dir, device="cuda")
    results["load_seconds_gpu"] = round(time.perf_counter() - t0, 1)
    t0 = time.perf_counter()
    cpu = DeepGazeIIEAdapter(settings.cache_dir, device="cpu")
    results["load_seconds_cpu"] = round(time.perf_counter() - t0, 1)

    # 1. Normalization and reproducibility
    repro = {}
    for sid in ("layout-a", "layout-b"):
        img = load(sid)
        g1, g2 = gpu.predict_attention(img).density, gpu.predict_attention(img).density
        c1, c2 = cpu.predict_attention(img).density, cpu.predict_attention(img).density
        grid = grid_of(g1, img)
        repro[sid] = {
            "density_shape": list(g1.shape),
            "grid_shape": list(grid.shape),
            "finite_nonnegative": bool(np.all(np.isfinite(g1)) and np.all(g1 >= 0)),
            "density_sum_minus_1": float(g1.sum() - 1),
            "grid_float32_sum_minus_1": float(grid.sum() - 1),
            "gpu_repeat_max_abs_diff": float(np.abs(g1 - g2).max()),
            "cpu_repeat_max_abs_diff": float(np.abs(c1 - c2).max()),
            "gpu_vs_cpu_max_rel_diff": float(np.abs(g1 - c1).max() / g1.max()),
            "gpu_vs_cpu_corr": corr(g1, c1),
            "gpu_vs_cpu_max_region_attention_diff": max(
                abs(rect_mass(g1, r) - rect_mass(c1, r)) for r in regions(sid).values()
            ),
            "peak_over_mean": round(float(g1.max() / g1.mean()), 2),
            "entropy_over_uniform": round(float(-(g1 * np.log(g1)).sum() / np.log(g1.size)), 4),
        }
    results["reproducibility"] = repro

    # 2. Region scores on the samples; grid (what the UI uses) vs full model resolution
    scores, grid_err = {}, 0.0
    densities = {}
    for sid in ("layout-a", "layout-b"):
        img = load(sid)
        d = gpu.predict_attention(img).density
        densities[sid] = d
        grid = grid_of(d, img)
        scores[sid] = {label: score(grid, rect) for label, rect in regions(sid).items()}
        grid_err = max(
            grid_err, *(abs(rect_mass(grid, r) - rect_mass(d, r)) for r in regions(sid).values())
        )
        results.setdefault("figures", {})[sid] = figure(sid, img, d, regions(sid))
    results["region_scores"] = scores
    results["grid_vs_full_resolution_max_abs_attention_diff"] = grid_err
    results["layout_a_vs_b_density_corr"] = corr(densities["layout-a"], densities["layout-b"])

    # 3. Robustness probes
    b = load("layout-b")
    rb = regions("layout-b")
    probes: dict = {}
    mirrored = gpu.predict_attention(ImageOps.mirror(b)).density[:, ::-1]
    probes["mirror_corr"] = corr(densities["layout-b"], mirrored)
    mirror_rects = {k: {**r, "x": 1 - r["x"] - r["width"]} for k, r in rb.items()}
    mirror_density = gpu.predict_attention(ImageOps.mirror(b)).density
    probes["mirror_cta"] = {
        "original": scores["layout-b"]["cta"],
        "mirrored": score(mirror_density, mirror_rects["cta"]),
    }

    lb, pad = letterbox(b)
    lb_rect = {
        k: {
            "x": r["x"],
            "width": r["width"],
            "y": (pad + r["y"] * b.height) / lb.height,
            "height": r["height"] * b.height / lb.height,
        }
        for k, r in rb.items()
    }
    lb_d = gpu.predict_attention(lb).density
    # Scores renormalized to the ad area only, so they are comparable with the original.
    ad_band = {"x": 0.0, "y": pad / lb.height, "width": 1.0, "height": b.height / lb.height}
    band_mass = rect_mass(lb_d, ad_band)
    probes["letterbox_square"] = {
        "attention_inside_ad_band": round(band_mass, 4),
        "cta_attention_share_of_ad": round(rect_mass(lb_d, lb_rect["cta"]) / band_mass, 4),
        "headline_attention_share_of_ad": round(
            rect_mass(lb_d, lb_rect["headline"]) / band_mass, 4
        ),
        "original_cta_attention": scores["layout-b"]["cta"]["attention"],
        "original_headline_attention": scores["layout-b"]["headline"]["attention"],
    }
    results["figures"]["letterbox"] = figure("letterbox", lb, lb_d, lb_rect)

    small = b.resize((300, 157), Image.Resampling.LANCZOS)
    small_d = gpu.predict_attention(small).density
    probes["low_resolution_300px"] = {
        label: {"original": scores["layout-b"][label], "downscaled": score(small_d, r)}
        for label, r in rb.items()
    }

    for name, (img, rects) in {
        "dense_text": dense_text_variant(),
        "schematic_face": face_variant(),
    }.items():
        d = gpu.predict_attention(img).density
        probes[name] = {
            "region": score(d, rects["custom"]),
            "cta": score(d, rb["cta"]),
            "cta_without_addition": scores["layout-b"]["cta"],
        }
        results["figures"][name] = figure(name, img, d, {**rects, "cta": rb["cta"]})

    blank = Image.new("RGB", (1200, 628), (200, 200, 200))
    blank_d = gpu.predict_attention(blank).density
    centre = {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}
    probes["blank_image"] = {
        "central_quarter_attention": round(rect_mass(blank_d, centre), 4),
        "corner_cta_sized_box_lift": score(
            blank_d, {"x": 0.05, "y": 0.86, "width": 0.14, "height": 0.07}
        )["lift"],
        "peak_over_mean": round(float(blank_d.max() / blank_d.mean()), 2),
        "bottom_5pct_rows_attention": round(
            rect_mass(blank_d, {"x": 0.0, "y": 0.95, "width": 1.0, "height": 0.05}), 4
        ),
        "peak_location_xy": peak_xy(blank_d),
    }
    results["figures"]["blank"] = figure("blank", blank, blank_d, {"centre": centre})
    results["probes"] = probes

    # 4. Runtime, memory, and payload by input size
    sizes = {
        "300x250 medium rectangle": (300, 250),
        "728x90 leaderboard": (728, 90),
        "1200x628 link ad": (1200, 628),
        "1080x1080 square": (1080, 1080),
        "1080x1920 story": (1080, 1920),
        "4000x5000 (20 MP) photo": (4000, 5000),
    }
    perf = {}
    client = TestClient(create_app(settings, model_loader=lambda: gpu))
    with client:
        client.app.state.model_holder.wait(10)
        for label, (w, h) in sizes.items():
            img = b.resize((w, h), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            fmt = "JPEG" if w * h > 4_000_000 else "PNG"
            img.save(buf, format=fmt, quality=90)
            upload = buf.getvalue()
            api_ms = []
            for _ in range(3):
                t = time.perf_counter()
                r = client.post(
                    "/v1/analyses", files={"image": ("x", upload, f"image/{fmt.lower()}")}
                )
                api_ms.append((time.perf_counter() - t) * 1000)
                assert r.status_code == 200, r.text
            body = r.json()
            perf[label] = {
                "upload_kib": round(len(upload) / 1024),
                "response_kib": round(len(r.content) / 1024),
                "heatmap_kib": round(len(body["heatmap"]["data_url"]) / 1024),
                "density_kib": round(len(body["density"]["data"]) / 1024),
                "grid": [body["density"]["width"], body["density"]["height"]],
                "api_end_to_end_gpu_median_ms": round(statistics.median(api_ms)),
                "gpu": time_inference(gpu, img, runs=5, device="cuda"),
                "cpu": time_inference(cpu, img, runs=2, device="cpu"),
            }
            print(label, json.dumps(perf[label]), flush=True)
    results["performance"] = perf

    (OUT / "results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in results.items() if k != "performance"}, indent=2))


if __name__ == "__main__":
    main()
