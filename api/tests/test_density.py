import numpy as np
import pytest

from focusframe_api.density import (
    decode_float32_le,
    encode_float32_le,
    grid_shape,
    integrate_to_grid,
    normalize_log_density,
)


class TestNormalizeLogDensity:
    def test_very_negative_log_values_do_not_underflow(self):
        # Naive exp() of these is exactly 0.0 in float64; the result must still be a distribution.
        log_density = np.array([[-2000.0, -2000.0 + np.log(3.0)]])
        density = normalize_log_density(log_density)
        assert density.sum() == pytest.approx(1.0, abs=1e-12)
        np.testing.assert_allclose(density, [[0.25, 0.75]], rtol=1e-12)

    def test_output_is_finite_nonnegative_and_sums_to_one(self):
        rng = np.random.default_rng(0)
        density = normalize_log_density(rng.normal(-15, 4, size=(67, 128)))
        assert np.all(np.isfinite(density))
        assert np.all(density >= 0)
        assert density.sum() == pytest.approx(1.0, abs=1e-12)

    @pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
    def test_rejects_non_finite_values(self, bad):
        log_density = np.zeros((4, 4))
        log_density[1, 2] = bad
        with pytest.raises(ValueError):
            normalize_log_density(log_density)


class TestGridShape:
    @pytest.mark.parametrize(
        ("size", "expected"),
        [
            ((1200, 628), (128, 67)),
            ((628, 1200), (67, 128)),
            ((1080, 1080), (128, 128)),
            ((728, 90), (128, 16)),
        ],
    )
    def test_longer_side_is_max_and_aspect_is_kept(self, size, expected):
        assert grid_shape(*size, max_side=128) == expected


class TestIntegrateToGrid:
    def test_straddling_pixel_is_split_by_overlap(self):
        # Three source pixels onto two cells: the middle pixel sits half in each cell.
        grid = integrate_to_grid(np.array([[0.2, 0.5, 0.3]]), grid_width=2, grid_height=1)
        np.testing.assert_allclose(grid, [[0.45, 0.55]], rtol=1e-12)

    @pytest.mark.parametrize(
        ("src", "dst"), [((536, 1024), (128, 67)), ((13, 7), (5, 3)), ((3, 5), (11, 8))]
    )
    def test_mass_is_conserved_for_non_divisible_sizes(self, src, dst):
        rng = np.random.default_rng(1)
        density = rng.random(src)
        density /= density.sum()
        grid = integrate_to_grid(density, *dst)
        assert grid.shape == (dst[1], dst[0])
        assert grid.sum() == pytest.approx(1.0, abs=1e-12)
        assert np.all(grid >= 0)

    def test_uniform_density_gives_equal_cells(self):
        grid = integrate_to_grid(np.full((536, 1024), 1 / (536 * 1024)), 128, 67)
        np.testing.assert_allclose(grid, 1 / (128 * 67), rtol=1e-9)

    def test_point_mass_lands_in_the_cell_at_the_same_normalized_position(self):
        density = np.zeros((536, 1024))
        # Pixel whose extent is fully inside normalized x in [0.30, 0.31), y in [0.70, 0.71).
        row, col = int(0.705 * 536), int(0.305 * 1024)
        density[row, col] = 1.0
        grid = integrate_to_grid(density, 128, 67)
        hot = np.unravel_index(np.argmax(grid), grid.shape)
        assert hot == (int(0.705 * 67), int(0.305 * 128))
        assert grid[hot] == pytest.approx(1.0)


class TestEncoding:
    def test_encoding_is_little_endian_float32_row_major(self):
        # 1.0f little-endian is 00 00 80 3f; 2.0f is 00 00 00 40.
        assert encode_float32_le(np.array([[1.0, 2.0]])) == "AACAPwAAAEA="

    def test_round_trip_preserves_shape_and_values(self):
        values = np.arange(12, dtype=np.float32).reshape(3, 4) / 7
        decoded = decode_float32_le(encode_float32_le(values), width=4, height=3)
        np.testing.assert_array_equal(decoded, values)
