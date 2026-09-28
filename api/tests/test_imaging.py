import numpy as np
import pytest
from PIL import Image

from focusframe_api.errors import ApiError
from focusframe_api.imaging import MAX_UPLOAD_BYTES, decode_upload
from focusframe_api.model_adapter import model_input_size, resize_centerbias

from .conftest import encode


def expect_error(status: int, data: bytes, mime: str = "image/png") -> ApiError:
    with pytest.raises(ApiError) as info:
        decode_upload(data, mime)
    assert info.value.status_code == status
    return info.value


def two_colour(width: int, height: int) -> Image.Image:
    """Left half red, right half blue."""
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[:, : width // 2] = (255, 0, 0)
    arr[:, width // 2 :] = (0, 0, 255)
    return Image.fromarray(arr)


class TestOrientation:
    def test_exif_rotation_is_applied_once_and_reported(self):
        exif = Image.Exif()
        exif[0x0112] = 6  # display = stored image rotated 90 degrees clockwise
        data = encode(two_colour(60, 40), "JPEG", exif=exif.tobytes(), quality=95)
        decoded = decode_upload(data, "image/jpeg")
        assert decoded.image.size == (40, 60)
        assert decoded.orientation_applied and decoded.exif_orientation == 6
        pixels = np.asarray(decoded.image).astype(int)
        # Stored left (red) becomes the top after a clockwise rotation.
        assert pixels[5, 20, 0] > 200 and pixels[5, 20, 2] < 60
        assert pixels[55, 20, 2] > 200 and pixels[55, 20, 0] < 60

    def test_image_without_orientation_is_unchanged(self):
        decoded = decode_upload(encode(two_colour(60, 40)), "image/png")
        assert decoded.image.size == (60, 40)
        assert not decoded.orientation_applied and decoded.exif_orientation is None


class TestModeConversion:
    def test_transparency_is_composited_on_white(self):
        rgba = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
        decoded = decode_upload(encode(rgba), "image/png")
        assert decoded.alpha_composited
        assert np.asarray(decoded.image).min() == 255

    def test_16_bit_greyscale_is_rescaled_not_clipped(self):
        grey16 = Image.fromarray(np.full((40, 40), 32768, dtype=np.uint16))
        decoded = decode_upload(encode(grey16), "image/png")
        assert decoded.image.mode == "RGB"
        assert np.asarray(decoded.image)[0, 0].tolist() == [128, 128, 128]


class TestRejections:
    def test_unsupported_declared_type(self):
        assert (
            expect_error(415, encode(two_colour(40, 40)), "image/gif").code
            == "unsupported_media_type"
        )

    def test_content_that_is_not_an_image_despite_png_mime(self):
        expect_error(415, b"<svg xmlns='http://www.w3.org/2000/svg'/>")

    def test_declared_type_must_match_content(self):
        expect_error(415, encode(two_colour(40, 40), "JPEG"), "image/png")

    def test_truncated_image_is_reported_as_corrupt(self):
        data = encode(Image.effect_noise((200, 200), 64).convert("RGB"))
        assert expect_error(400, data[: len(data) // 2]).code == "invalid_image"

    def test_oversized_upload(self):
        data = b"\x89PNG\r\n\x1a\n" + b"\0" * MAX_UPLOAD_BYTES
        assert expect_error(413, data).code == "payload_too_large"

    def test_decompression_bomb_is_rejected_before_decoding(self):
        # 5000x5000 = 25 MP of a single colour compresses to a tiny file.
        data = encode(Image.new("L", (5000, 5000)))
        assert len(data) < 100_000
        assert expect_error(422, data).code == "invalid_dimensions"

    @pytest.mark.parametrize("size", [(20, 200), (1000, 100)])
    def test_too_small_or_too_elongated(self, size):
        expect_error(422, encode(Image.new("RGB", size)))

    def test_leaderboard_banner_is_accepted(self):
        assert decode_upload(encode(Image.new("RGB", (728, 90))), "image/png").image.size == (
            728,
            90,
        )

    def test_animated_png_is_rejected(self):
        frames = [Image.new("RGB", (40, 40), c) for c in ("red", "blue")]
        data = encode(frames[0], save_all=True, append_images=frames[1:])
        expect_error(415, data)


class TestModelPreprocessing:
    @pytest.mark.parametrize(
        ("size", "expected"),
        [((1200, 628), (1024, 536)), ((300, 250), (1024, 853)), ((628, 1200), (536, 1024))],
    )
    def test_model_input_keeps_aspect_with_1024_long_side(self, size, expected):
        assert model_input_size(*size) == expected

    def test_centerbias_resize_is_exact_and_normalized(self):
        from scipy.special import logsumexp

        template = np.log(np.random.default_rng(0).random((1024, 1024)))
        resized = resize_centerbias(template, 853, 1024)
        assert resized.shape == (853, 1024)
        assert logsumexp(resized) == pytest.approx(0.0, abs=1e-9)
