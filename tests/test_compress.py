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
