"""Generate the bundled sample ads and their preset regions.

The samples are synthetic layouts drawn with Pillow for a fictional brand, so
the project owns them outright (no stock photos). Fonts are DejaVu, shipped
with matplotlib under a permissive license. The generator knows each element's
exact bounding box, so the example regions are exact rather than hand-traced.

Run from the repository root with the API virtualenv:

    api/.venv/Scripts/python samples/generate_samples.py   (Windows)
    api/.venv/bin/python samples/generate_samples.py       (macOS/Linux)
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import matplotlib
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_IMAGES = ROOT / "web" / "public" / "samples"
OUT_MANIFEST = ROOT / "web" / "src" / "data" / "samples.json"

W, H = 1200, 628
FONT_DIR = Path(matplotlib.get_data_path()) / "fonts" / "ttf"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(str(FONT_DIR / name), size)


Box = tuple[int, int, int, int]  # left, top, right, bottom (exclusive), pixels


@dataclass
class Region:
    label: str
    name: str
    box: Box


def text_box(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, f, fill) -> Box:
    draw.text(xy, text, font=f, fill=fill)
    left, top, right, bottom = draw.textbbox(xy, text, font=f)
    return (left, top, right, bottom)


def union(*boxes: Box, pad: int = 0) -> Box:
    return (
        min(b[0] for b in boxes) - pad,
        min(b[1] for b in boxes) - pad,
        max(b[2] for b in boxes) + pad,
        max(b[3] for b in boxes) + pad,
    )


def background(draw: ImageDraw.ImageDraw) -> None:
    for y in range(H):
        t = y / (H - 1)
        r = int(222 + (246 - 222) * t)
        g = int(236 + (241 - 236) * t)
        b = int(243 + (232 - 243) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    draw.polygon([(0, 520), (170, 380), (300, 470), (470, 330), (650, 500), (650, 628), (0, 628)],
                 fill=(196, 214, 206))
    draw.polygon([(520, 628), (760, 410), (900, 520), (1060, 390), (1200, 480), (1200, 628)],
                 fill=(176, 199, 190))


def bottle(draw: ImageDraw.ImageDraw, cx: int, top: int, scale: float) -> Box:
    bw, bh = int(150 * scale), int(360 * scale)
    left = cx - bw // 2
    cap_w, cap_h = int(80 * scale), int(52 * scale)
    draw.rounded_rectangle([cx - cap_w // 2, top, cx + cap_w // 2, top + cap_h],
                           radius=int(12 * scale), fill=(40, 48, 56))
    body_top = top + cap_h - int(6 * scale)
    draw.rounded_rectangle([left, body_top, left + bw, body_top + bh],
                           radius=int(40 * scale), fill=(28, 111, 128))
    draw.rounded_rectangle([left + int(14 * scale), body_top + int(20 * scale),
                            left + int(34 * scale), body_top + bh - int(40 * scale)],
                           radius=int(10 * scale), fill=(86, 164, 178))
    band_top = body_top + int(130 * scale)
    draw.rectangle([left, band_top, left + bw, band_top + int(90 * scale)], fill=(245, 245, 240))
    f = font(int(26 * scale), bold=True)
    tw = draw.textlength("NL", font=f)
    draw.text((cx - tw / 2, band_top + int(28 * scale)), "NL", font=f, fill=(28, 111, 128))
    return (left, top, left + bw, body_top + bh)


def logo(draw: ImageDraw.ImageDraw, xy: tuple[int, int], size: int) -> Box:
    x, y = xy
    draw.ellipse([x, y, x + size, y + size], fill=(28, 111, 128))
    draw.polygon([(x + size * 0.2, y + size * 0.72), (x + size * 0.5, y + size * 0.25),
                  (x + size * 0.8, y + size * 0.72)], fill=(245, 245, 240))
    word = text_box(draw, (x + size + 12, y + size // 2 - int(size * 0.32)), "NORTHLOOP",
                    font(int(size * 0.55), bold=True), (40, 48, 56))
    return union((x, y, x + size, y + size), word)


def cta(draw: ImageDraw.ImageDraw, box: Box, text: str, f, fill, text_fill) -> Box:
    draw.rounded_rectangle(box, radius=(box[3] - box[1]) // 2, fill=fill)
    tl, tt, tr, tb = draw.textbbox((0, 0), text, font=f)
    tx = box[0] + ((box[2] - box[0]) - (tr - tl)) / 2 - tl
    ty = box[1] + ((box[3] - box[1]) - (tb - tt)) / 2 - tt
    draw.text((tx, ty), text, font=f, fill=text_fill)
    return box


def variant_a() -> tuple[Image.Image, list[Region]]:
    """Large headline, product to the right, small low-contrast CTA in a corner."""
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    background(d)
    logo_box = logo(d, (60, 44), 46)
    h1 = text_box(d, (60, 140), "Carry the", font(76, bold=True), (40, 48, 56))
    h2 = text_box(d, (60, 228), "whole trail.", font(76, bold=True), (40, 48, 56))
    sub = text_box(d, (62, 330), "Insulated 750 ml bottle. Cold for 24 hours.", font(28), (70, 80, 88))
    product = bottle(d, 900, 110, 1.15)
    cta_box = cta(d, (62, 540, 232, 584), "Shop now", font(22), (206, 214, 210), (96, 104, 108))
    return img, [
        Region("logo", "Brand", logo_box),
        Region("headline", "Headline", union(h1, h2, pad=6)),
        Region("product", "Bottle", product),
        Region("cta", "Shop now button", cta_box),
    ]


def variant_b() -> tuple[Image.Image, list[Region]]:
    """Smaller headline, product left, large high-contrast CTA near the product."""
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    background(d)
    product = bottle(d, 260, 110, 1.15)
    logo_box = logo(d, (520, 60), 46)
    h1 = text_box(d, (520, 160), "Carry the whole trail.", font(52, bold=True), (40, 48, 56))
    sub = text_box(d, (522, 236), "Insulated 750 ml bottle. Cold for 24 hours.", font(26), (70, 80, 88))
    cta_box = cta(d, (520, 330, 860, 414), "Shop now", font(38, bold=True), (232, 93, 36),
                  (255, 255, 255))
    del sub
    return img, [
        Region("logo", "Brand", logo_box),
        Region("headline", "Headline", union(h1, pad=6)),
        Region("product", "Bottle", product),
        Region("cta", "Shop now button", cta_box),
    ]


def normalized(box: Box, size: tuple[int, int]) -> dict[str, float]:
    w, h = size
    left, top, right, bottom = (max(0, box[0]), max(0, box[1]), min(w, box[2]), min(h, box[3]))
    return {
        "x": round(left / w, 6),
        "y": round(top / h, 6),
        "width": round((right - left) / w, 6),
        "height": round((bottom - top) / h, 6),
    }


def main() -> None:
    OUT_IMAGES.mkdir(parents=True, exist_ok=True)
    OUT_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    samples = []
    for sample_id, title, fn in [
        ("layout-a", "Layout A: corner CTA", variant_a),
        ("layout-b", "Layout B: prominent CTA", variant_b),
    ]:
        img, regions = fn()
        filename = f"{sample_id}.png"
        img.save(OUT_IMAGES / filename, format="PNG", optimize=True)
        samples.append({
            "id": sample_id,
            "title": title,
            "src": f"/samples/{filename}",
            "filename": filename,
            "width": img.width,
            "height": img.height,
            "regions": [
                {"label": r.label, "name": r.name, "rect": normalized(r.box, img.size)}
                for r in regions
            ],
        })
    OUT_MANIFEST.write_text(json.dumps({"samples": samples}, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(samples)} samples to {OUT_IMAGES} and {OUT_MANIFEST}")


if __name__ == "__main__":
    main()
