import numpy as np
import pytest

from svdcomp import metrics
from svdcomp.cli import main
from svdcomp.compress import (compress, compress_blocks, decompose, rank_for_energy, reconstruct,
                              result_for_rank, storage_cost)
from svdcomp.formats import read_image, write_image

rng = np.random.default_rng(7)
x = np.linspace(0, 1, 48)
SMOOTH = np.clip(128 + 100 * np.outer(np.sin(4 * x), np.cos(3 * x)), 0, 255).astype(np.uint8)
NOISY = rng.integers(0, 256, (40, 56, 3), dtype=np.uint8)


def test_storage_and_ratio():
    assert storage_cost(512, 512, 50) == 51_250  # the primer's worked example
    r = compress(NOISY, k=5)
    assert r.stored_values == 3 * 5 * (40 + 56 + 1)
    assert r.ratio == pytest.approx(NOISY.size / r.stored_values)


def test_eckart_young_identity():
    """||A - A_k||_F^2 equals the sum of the discarded sigma_i^2 (before rounding)."""
    f = decompose(NOISY)
    A = np.moveaxis(NOISY, 2, 0).astype(float)
    for k in (1, 10, 30):
        Ak = (f.U[:, :, :k] * f.s[:, None, :k]) @ f.Vt[:, :k, :]
        np.testing.assert_allclose(np.sum((A - Ak) ** 2), np.sum(f.s[:, k:] ** 2), rtol=1e-8)


def test_full_rank_reconstruction_is_lossless():
    f = decompose(NOISY)
    np.testing.assert_array_equal(reconstruct(f, f.max_rank), NOISY)
    assert reconstruct(decompose(SMOOTH), 48).shape == SMOOTH.shape


def test_quality_increases_with_rank():
    f = decompose(NOISY)
    psnrs = [result_for_rank(NOISY, f, k).metrics["psnr"] for k in (1, 5, 20, 40)]
    assert psnrs == sorted(psnrs)


def test_rank_for_energy():
    s = np.array([3.0, 2.0, 1.0, 0.0])  # energies 9, 4, 1 of 14
    assert rank_for_energy(s, 9 / 14) == 1
    assert rank_for_energy(s, 0.9) == 2
    assert rank_for_energy(s, 1.0) == 3
    assert rank_for_energy(np.zeros(3), 0.5) == 1
    assert rank_for_energy(s[:2], 0.99, total=14.0) == 2  # truncated spectrum caps at its length
    with pytest.raises(ValueError):
        rank_for_energy(s, 0)


def test_energy_target_is_met():
    r = compress(NOISY, energy=0.9)
    assert r.metrics["energy"] >= 0.9
    smaller = result_for_rank(NOISY, decompose(NOISY), r.k - 1)
    assert smaller.metrics["energy"] < 0.9


def test_randomized_matches_exact_on_low_rank_image():
    img = SMOOTH  # rank 1 + rounding
    exact = compress(img, k=3)
    approx = compress(img, k=3, method="randomized")
    assert approx.metrics["psnr"] == pytest.approx(exact.metrics["psnr"], abs=0.5)


def test_compress_argument_validation():
    with pytest.raises(ValueError):
        compress(SMOOTH)
    with pytest.raises(ValueError):
        compress(SMOOTH, k=2, energy=0.9)
    with pytest.raises(ValueError):
        compress(SMOOTH, k=2, method="magic")


def test_blocks_adapt_rank_to_content():
    img = np.zeros((64, 64), dtype=np.uint8)
    img[:, 32:] = rng.integers(0, 256, (64, 32))  # right half busy, left half flat
    r = compress_blocks(img, block=16, energy=0.99)
    assert r.k.shape == (4, 4)
    assert np.all(r.k[:, :2] == 0) and np.all(r.k[:, 2:] > 5)
    assert r.stored_values == sum(storage_cost(16, 16, k) + 1 for k in r.k.ravel())
    assert r.metrics["detail_energy"] >= 0.99
    np.testing.assert_array_equal(r.image[:, :32], 0)  # flat half costs one mean per tile


def test_blocks_ragged_edges_and_color():
    r = compress_blocks(NOISY, block=16, energy=1.0)
    assert r.k.shape == (3, 4)
    np.testing.assert_array_equal(r.image, NOISY)


def test_metrics_known_values():
    a = np.zeros((20, 20))
    b = np.full((20, 20), 5.0)
    assert metrics.mse(a, b) == 25
    assert metrics.psnr(a, b) == pytest.approx(10 * np.log10(255 ** 2 / 25))
    assert metrics.psnr(a, a) == float("inf")
    assert metrics.ssim(NOISY, NOISY) == pytest.approx(1.0)
    assert metrics.ssim(NOISY, 255 - NOISY) < 0.1
    assert metrics.relative_error(np.ones((3, 3)), np.zeros((3, 3))) == 1.0
    with pytest.raises(ValueError):
        metrics.mse(a, b[:3])


def test_cli_end_to_end(tmp_path, capsys):
    src = tmp_path / "in.ppm"
    write_image(src, NOISY)
    out = tmp_path / "out.png"
    assert main(["compress", str(src), str(out), "-k", "4"]) == 0
    assert read_image(out).shape == NOISY.shape
    assert main(["compress", str(src), str(out), "--blocks", "16", "--energy", "0.9"]) == 0
    assert main(["info", str(src), "--sigma-csv", str(tmp_path / "s.csv")]) == 0
    assert (tmp_path / "s.csv").read_text().count("\n") == 41
    assert main(["benchmark", str(src), "--ks", "1,4", "--csv", str(tmp_path / "b.csv")]) == 0
    assert (tmp_path / "b.csv").read_text().startswith("k,stored_values")
    assert main(["compress", str(tmp_path / "missing.png"), str(out), "-k", "1"]) == 1
    assert "error" in capsys.readouterr().err


def test_randomized_energy_default_budget_regression():
    img = np.eye(300, dtype=np.uint8) * 255
    with pytest.raises(ValueError, match=r"0.95.*200.*0.666"):
        compress(img, energy=0.95, method="randomized", seed=0)


def test_randomized_energy_sufficient_budget():
    img = np.eye(300, dtype=np.uint8) * 255
    result = compress(img, energy=0.95, method="randomized", rank_budget=300)
    assert result.k == 285
    assert result.metrics["energy"] >= 0.95 - 1e-12


@pytest.mark.parametrize("budget", [0, -1, 49, 1.5, True])
def test_randomized_invalid_rank_budget(budget):
    with pytest.raises(ValueError, match="rank_budget"):
        compress(SMOOTH, energy=0.9, method="randomized", rank_budget=budget)


@pytest.mark.parametrize("channels", [None, 3, 4])
def test_randomized_energy_success_and_zero(channels):
    shape = (12, 16) if channels is None else (12, 16, channels)
    img = np.full(shape, 80, dtype=np.uint8)
    result = compress(img, energy=1.0, method="randomized", rank_budget=1)
    assert result.metrics["energy"] >= 1.0 - 1e-12
    zero = compress(np.zeros(shape, dtype=np.uint8), energy=1.0, method="randomized")
    assert zero.metrics["energy"] == 1.0


@pytest.mark.parametrize("budget", ["0", "-1", "13", "2", "12"])
def test_cli_randomized_rank_budget(tmp_path, capsys, budget):
    img = np.eye(12, dtype=np.uint8) * 255
    src, out = tmp_path / "in.png", tmp_path / "out.png"
    write_image(src, img)
    code = main(["compress", str(src), str(out), "--method", "randomized",
                 "--energy", "0.95", "--rank-budget", budget])
    captured = capsys.readouterr()
    if budget == "12":
        assert code == 0 and out.exists()
        assert "100.000 %" in captured.out
    else:
        assert code == 1 and not out.exists()
        assert "svdcomp: error:" in captured.err
        assert "rank_budget" in captured.err or "rank budget 2" in captured.err


def test_fixed_rank_randomized_budget_preserved():
    result = compress(SMOOTH, k=3, method="randomized", rank_budget=5)
    assert result.k == 3


def _tied_tile():
    img = np.zeros((4, 4), dtype=np.uint8)
    img[np.arange(4), [0, 2, 3, 1]] = 255
    return img


def test_blocks_tied_energy_regression():
    result = compress_blocks(_tied_tile(), block=4, energy=0.5)
    np.testing.assert_array_equal(result.k, [[2]])
    assert result.metrics["detail_energy"] >= 0.5
    assert result.stored_values == 19


def test_blocks_multitile_ties_deterministic_prefix():
    img = np.tile(_tied_tile(), (2, 2))
    for _ in range(2):
        result = compress_blocks(img, block=4, energy=0.5)
        np.testing.assert_array_equal(result.k, [[2, 2], [1, 1]])
        assert result.k.sum() == 6
        assert result.metrics["detail_energy"] >= 0.5 - 1e-12
        assert result.stored_values == 4 + 6 * 9


@pytest.mark.parametrize("channels", [None, 3, 4])
@pytest.mark.parametrize("energy", [0.5, 1.0])
def test_blocks_ties_ragged_color_and_storage(channels, energy):
    gray = np.pad(np.tile(_tied_tile(), (2, 2)), ((0, 1), (0, 2)))
    img = gray if channels is None else np.repeat(gray[:, :, None], channels, axis=2)
    result = compress_blocks(img, block=4, energy=energy)
    assert result.metrics["detail_energy"] >= energy - 1e-12
    assert np.all(result.k[2, :] == 0) and np.all(result.k[:, 2] == 0)
    count = 1 if channels is None else channels
    expected = sum(count * (1 + int(result.k[i, j]) * (min(4, 9 - i * 4) + min(4, 10 - j * 4) + 1))
                   for i in range(3) for j in range(3))
    assert result.stored_values == expected
    if energy == 1.0:
        np.testing.assert_array_equal(result.image, img)


@pytest.mark.parametrize("channels", [None, 3, 4])
@pytest.mark.parametrize("energy", [1e-15, 1e-12, np.nextafter(1e-12, np.inf), 1.0])
def test_blocks_zero_detail_tiles(channels, energy):
    shape = (5, 7) if channels is None else (5, 7, channels)
    img = np.full(shape, 80, dtype=np.uint8)
    result = compress_blocks(img, block=4, energy=energy)
    assert not result.k.any()
    assert result.metrics["detail_energy"] == 1.0
    assert result.stored_values == 4 * (1 if channels is None else channels)
    np.testing.assert_array_equal(result.image, img)


@pytest.mark.parametrize("channels", [None, 3, 4])
@pytest.mark.parametrize("seed", [0, 2, 7])
@pytest.mark.parametrize("method", ["exact", "randomized"])
def test_energy_boundary_uses_reported_energy_and_minimum_rank(channels, seed, method):
    shape = (12, 17) if channels is None else (12, 17, channels)
    img = np.random.default_rng(0).integers(0, 256, shape, dtype=np.uint8)
    f = decompose(img, method=method, rank=12, seed=seed)
    reported = [float(np.sum(f.s[:, :k] ** 2)) / f.energy_total
                for k in range(1, 13)]
    cumulative = np.cumsum(np.sum(f.s ** 2, axis=0)) / f.energy_total
    for fraction in cumulative[:-1]:
        target = float(fraction + 1e-12)
        result = compress(img, energy=target, method=method, rank_budget=12, seed=seed)
        expected = next(k for k, value in enumerate(reported, 1) if value >= target - 1e-12)
        assert result.metrics["energy"] >= target - 1e-12
        assert result.k == expected
        assert result.metrics["energy"] == reported[expected - 1]


@pytest.mark.parametrize("seed", [0, 2, 7])
def test_energy_boundary_budget_exhaustion(seed):
    img = np.random.default_rng(0).integers(0, 256, (12, 17, 3), dtype=np.uint8)
    f = decompose(img, method="randomized", rank=8, seed=seed)
    attainable = float(np.sum(f.s ** 2)) / f.energy_total
    target = float(np.nextafter(attainable + 1e-12, np.inf))
    assert target - 1e-12 > attainable
    with pytest.raises(ValueError, match="rank budget 8; attainable energy"):
        compress(img, energy=target, method="randomized", rank_budget=8, seed=seed)
    fixed = compress(img, k=3, method="randomized", rank_budget=8, seed=seed)
    expected = result_for_rank(img, f, 3)
    assert fixed.k == expected.k
    assert fixed.metrics == expected.metrics
    np.testing.assert_array_equal(fixed.image, expected.image)


@pytest.mark.parametrize("energy", [1e-15, np.nextafter(1e-12, 0), 1e-12,
                                    np.nextafter(1e-12, np.inf)])
@pytest.mark.parametrize("channels", [None, 3, 4])
@pytest.mark.parametrize("ragged", [False, True])
def test_blocks_tolerance_includes_empty_selection(energy, channels, ragged):
    gray = np.tile(_tied_tile(), (2, 2))
    if ragged:
        gray = np.pad(gray, ((0, 1), (0, 2)))
    img = gray if channels is None else np.repeat(gray[:, :, None], channels, axis=2)
    result = compress_blocks(img, block=4, energy=energy)
    expected = np.zeros(result.k.shape, dtype=int)
    if energy > 1e-12:
        expected[0, 0] = 1
    np.testing.assert_array_equal(result.k, expected)
    assert result.metrics["detail_energy"] >= energy - 1e-12
    if energy <= 1e-12:
        assert result.metrics["detail_energy"] == 0.0
    count = 1 if channels is None else channels
    assert result.stored_values == count * (expected.size + 9 * int(expected.sum()))
    repeated = compress_blocks(img, block=4, energy=energy)
    np.testing.assert_array_equal(repeated.k, expected)


def test_blocks_tiny_target_original_fixture():
    result = compress_blocks(_tied_tile(), block=4, energy=1e-15)
    assert result.k.tolist() == [[0]]
    assert result.stored_values == 1
    assert result.metrics["detail_energy"] == 0.0
