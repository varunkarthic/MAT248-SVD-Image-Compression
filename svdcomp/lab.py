"""Helpers behind the SVD Lab web interface.

Everything here derives from the package's own SVD (:mod:`svdcomp.linalg`) and
compression code. The browser only draws what these functions return.
"""

import numpy as np

from .compress import result_for_rank, storage_cost
from .formats import as_uint8_image
from .linalg import jacobi_svd

# Diverging palette for signed matrices (negative -> cobalt, zero -> paper, positive -> vermilion).
_NEG, _MID, _POS = (31, 78, 163), (250, 247, 240), (200, 62, 38)


def spectral_curves(factors, method="exact"):
    """Per-``k`` quantities that follow from the singular values alone (k = 1..r).

    ``energy`` is E(k) = sum_{i<=k} sigma_i^2 / ||A||_F^2 and, for an exact SVD,
    ``spectral_error`` is ||A - A_k||_F = sqrt(sum_{i>k} sigma_i^2) (Eckart-Young).
    That is the *mathematical* error before rounding to 8-bit pixels. For the
    randomized SVD the tail is only an estimate (``exact`` is False).
    """
    sq = (factors.s ** 2).sum(axis=0)
    total = factors.energy_total
    cumulative = np.cumsum(sq)
    tail = np.maximum(total - cumulative, 0.0)
    ks = np.arange(1, sq.size + 1)
    m, n = factors.shape
    return {
        "k": ks.tolist(),
        "energy": (cumulative / total if total else np.ones_like(sq)).tolist(),
        "spectral_error": np.sqrt(tail).tolist(),
        "relative_spectral_error": (np.sqrt(tail / total) if total else np.zeros_like(sq)).tolist(),
        "stored_values": [storage_cost(m, n, int(k), factors.channels) for k in ks],
        "original_values": int(m * n * factors.channels),
        "exact": method == "exact",
    }


def sample_ranks(max_rank, points=24):
    """Roughly log-spaced ranks 1..max_rank (always including both ends)."""
    if max_rank <= points:
        return list(range(1, max_rank + 1))
    ks = np.unique(np.round(np.geomspace(1, max_rank, points)).astype(int))
    return ks.tolist()


def pixel_curves(img, factors, points=24):
    """Measured quality at sampled ranks (after rounding/clipping to 8-bit pixels)."""
    rows = []
    for k in sample_ranks(factors.max_rank, points):
        res = result_for_rank(img, factors, k)
        m = res.metrics
        rows.append({
            "k": k,
            "psnr": None if not np.isfinite(m["psnr"]) else m["psnr"],
            "ssim": m["ssim"],
            "mse": m["mse"],
            "relative_error": m["relative_error"],
            "frobenius_error": float(np.sqrt(m["mse"] * res.original_values)),
            "stored_values": res.stored_values,
        })
    return rows


def _colorize(values, vmax):
    """Map signed ``values`` in [-vmax, vmax] onto the diverging palette -> uint8 RGB."""
    t = np.clip(values / vmax, -1.0, 1.0) if vmax > 0 else np.zeros_like(values)
    neg, mid, pos = (np.array(c, dtype=float) for c in (_NEG, _MID, _POS))
    a = np.abs(t)[..., None]
    target = np.where((t < 0)[..., None], neg, pos)
    return np.rint(mid + (target - mid) * a).astype(np.uint8)


def component_image(factors, i):
    """Rank-one term sigma_i u_i v_i^T as a diverging-colour image.

    Returns ``(rgb_image, info)``. For colour images the displayed matrix is the
    mean of the colour channels' rank-one terms. ``vmax`` is the symmetric range
    represented by the colour scale.
    """
    i = int(np.clip(i, 1, factors.max_rank))
    terms = factors.s[:, None, None, i - 1] * factors.U[:, :, None, i - 1] * factors.Vt[:, None, i - 1, :]
    shown = terms[0] if factors.channels == 1 else terms[:min(3, factors.channels)].mean(axis=0)
    vmax = float(np.max(np.abs(shown))) or 1.0
    sq = (factors.s ** 2).sum(axis=0)
    total = factors.energy_total
    info = {
        "i": i,
        "sigma": [float(v) for v in factors.s[:, i - 1]],
        "vmax": vmax,
        "energy_share": float(sq[i - 1] / total) if total else 0.0,
        "energy_cumulative": float(sq[:i].sum() / total) if total else 1.0,
    }
    return _colorize(shown, vmax), info


def difference_image(original, approx):
    """Absolute pixel error as a paper-to-cobalt heat map, scaled to its own maximum."""
    a = as_uint8_image(original).astype(float)
    b = as_uint8_image(approx).astype(float)
    err = np.abs(a - b)
    if err.ndim == 3:
        err = err.max(axis=2)
    top = float(err.max())
    t = (err / top if top > 0 else np.zeros_like(err))[..., None]
    mid, dark = np.array(_MID, dtype=float), np.array((20, 40, 80), dtype=float)
    return np.rint(mid + (dark - mid) * t).astype(np.uint8), top


def worked_example():
    """The professor's 2 x 2 example A = [[3, 1], [1, 3]], computed by the package's own SVD."""
    A = np.array([[3.0, 1.0], [1.0, 3.0]])
    U, s, Vt = (x[0] for x in jacobi_svd(A[None]))
    flip = np.where(U[0] < 0, -1.0, 1.0)            # fix the sign ambiguity: first row of U positive
    U, Vt = U * flip, Vt * flip[:, None]
    parts = [s[i] * np.outer(U[:, i], Vt[i]) for i in range(2)]
    A1 = parts[0]
    residual = A - A1
    energy = s ** 2
    return {
        "A": A.tolist(), "AtA": (A.T @ A).tolist(),
        "eigenvalues": energy.tolist(), "sigma": s.tolist(),
        "U": U.tolist(), "Vt": Vt.tolist(),
        "rank_one_terms": [p.tolist() for p in parts],
        "A1": A1.tolist(), "residual": residual.tolist(),
        "residual_frobenius": float(np.sqrt(np.sum(residual ** 2))),
        "energy_rank1": float(energy[0] / energy.sum()),
        "reconstruction_error": float(np.max(np.abs(sum(parts) - A))),
        "stored_values_rank1": storage_cost(2, 2, 1), "original_values": 4,
    }


__all__ = ["spectral_curves", "sample_ranks", "pixel_curves", "component_image", "difference_image",
           "worked_example"]
