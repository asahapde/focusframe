"""Upload validation and image normalization (model-independent).

Everything here runs before model inference and is deterministic: the same
bytes always produce the same RGB image.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import ApiError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 20_000_000
MIN_SIDE = 32
MAX_ASPECT_RATIO = 8.5  # covers 728x90 leaderboards (8.09:1)

ALLOWED_MIME = {"image/png": "PNG", "image/jpeg": "JPEG"}
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"
_EXIF_ORIENTATION = 0x0112

# Pillow raises DecompressionBombError above 2x this value while opening, before
# any pixel data is decoded; our own dimension check below is the stricter one.
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


@dataclass(frozen=True)
class DecodedImage:
    image: Image.Image  # RGB, orientation applied
    source_format: str
    source_mode: str
    exif_orientation: int | None
    orientation_applied: bool
    alpha_composited: bool


def sniff_format(data: bytes) -> str | None:
    if data.startswith(_PNG_MAGIC):
        return "PNG"
    if data.startswith(_JPEG_MAGIC):
        return "JPEG"
    return None


def check_dimensions(width: int, height: int) -> None:
    if width * height > MAX_PIXELS:
        raise ApiError(
            422,
            "invalid_dimensions",
            f"Image is {width}x{height} ({width * height / 1e6:.1f} MP); the limit is "
            f"{MAX_PIXELS / 1e6:.0f} MP.",
        )
    if min(width, height) < MIN_SIDE:
        raise ApiError(422, "invalid_dimensions", f"Image sides must be at least {MIN_SIDE} px.")
    if max(width, height) / min(width, height) > MAX_ASPECT_RATIO:
        raise ApiError(
            422,
            "invalid_dimensions",
            f"Aspect ratio exceeds {MAX_ASPECT_RATIO}:1 and is outside the supported range.",
        )


def decode_upload(data: bytes, declared_mime: str | None) -> DecodedImage:
    """Validate upload bytes and return an RGB image with EXIF orientation applied.

    Raises ApiError with the status codes defined in the API contract.
    """
    mime = (declared_mime or "").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        raise ApiError(415, "unsupported_media_type", "Only PNG and JPEG uploads are supported.")
    if len(data) == 0:
        raise ApiError(400, "invalid_image", "The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "payload_too_large", "The upload exceeds the 10 MiB limit.")

    detected = sniff_format(data)
    if detected is None:
        raise ApiError(
            415, "unsupported_media_type", "The file content is not a PNG or JPEG image."
        )
    if detected != ALLOWED_MIME[mime]:
        raise ApiError(
            415,
            "unsupported_media_type",
            f"The file was declared as {mime} but its content is {detected}.",
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(data), formats=[detected])
            check_dimensions(*image.size)
            if getattr(image, "is_animated", False):
                raise ApiError(415, "unsupported_media_type", "Animated images are not supported.")
            image.load()
    except ApiError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ApiError(
            422, "invalid_dimensions", "Image dimensions exceed the pixel limit."
        ) from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise ApiError(
            400, "invalid_image", "The image could not be decoded; it may be corrupt."
        ) from None

    source_mode = image.mode
    orientation = image.getexif().get(_EXIF_ORIENTATION)
    oriented = ImageOps.exif_transpose(image)
    orientation_applied = orientation not in (None, 1)
    check_dimensions(*oriented.size)

    rgb, composited = to_rgb(oriented)
    return DecodedImage(
        image=rgb,
        source_format=detected,
        source_mode=source_mode,
        exif_orientation=int(orientation) if orientation is not None else None,
        orientation_applied=orientation_applied,
        alpha_composited=composited,
    )


def to_rgb(image: Image.Image) -> tuple[Image.Image, bool]:
    """Convert any decoded PNG/JPEG mode to 8-bit RGB.

    Transparent pixels are composited over white, the usual ad presentation
    background. 16-bit greyscale is rescaled rather than clipped.
    """
    if image.mode in ("I;16", "I;16B", "I;16L", "I"):
        arr = np.asarray(image, dtype=np.float64)
        peak = 65535.0 if image.mode.startswith("I;16") else max(float(arr.max()), 1.0)
        grey = np.clip(np.round(arr / peak * 255.0), 0, 255).astype(np.uint8)
        return Image.fromarray(grey, mode="L").convert("RGB"), False

    has_alpha = image.mode in ("RGBA", "LA", "PA") or (
        image.mode == "P" and "transparency" in image.info
    )
    if has_alpha:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(background, rgba).convert("RGB"), True
    return image.convert("RGB"), False
