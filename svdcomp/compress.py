"""Rank-k image compression on top of the from-scratch SVD.

An image with ``C`` channels is treated as ``C`` matrices of size ``m x n``,
decomposed together as one batch. Keeping ``k`` singular triplets per channel
costs ``C * k * (m + n + 1)`` stored numbers instead of ``C * m * n``.
"""

from dataclasses import dataclass, field

import numpy as np

from . import metrics
from .formats import as_uint8_image
from .linalg import jacobi_svd, randomized_svd

METHODS = ("exact", "randomized")


@dataclass
class Factors:
    """Per-channel SVD factors of an image.

    ``U`` has shape ``(C, m, r)``, ``s`` ``(C, r)`` and ``Vt`` ``(C, r, n)``.
    ``energy_total`` is ``||A||_F^2`` summed over channels. It is exact even
    when only the leading ``r`` triplets were computed.
    """

    U: np.ndarray
    s: np.ndarray
    Vt: np.ndarray
    energy_total: float
    gray: bool

    @property
    def shape(self):
        return self.U.shape[1], self.Vt.shape[2]

    @property
    def channels(self):
        return self.s.shape[0]

    @property
    def max_rank(self):
        return self.s.shape[1]


@dataclass
class CompressionResult:
    """Output of :func:`compress` / :func:`compress_blocks`."""

    image: np.ndarray
    k: object  # int for global compression, (rows, cols) rank map for blocks
    stored_values: int
    original_values: int
    metrics: dict = field(default_factory=dict)

    @property
    def ratio(self):
        """Original numbers / stored numbers (> 1 means the factors are smaller)."""
        return self.original_values / self.stored_values


def to_channels(img):
    """``uint8`` image -> float stack ``(C, m, n)`` plus a grayscale flag."""
    img = as_uint8_image(img)
    if img.ndim == 2:
        return img[None].astype(float), True
    return np.moveaxis(img, 2, 0).astype(float), False


def from_channels(stack, gray):
    """Float stack ``(C, m, n)`` -> ``uint8`` image (rounded and clipped to [0, 255])."""
    img = stack[0] if gray else np.moveaxis(stack, 0, 2)
    return as_uint8_image(img)


def storage_cost(m, n, k, channels=1):
    """Numbers needed to store ``k`` triplets ``(u_i, sigma_i, v_i)`` per channel."""
    return channels * k * (m + n + 1)


def rank_for_energy(s, energy, total=None):
    """Smallest ``k`` whose leading triplets keep at least ``energy`` of ``sum sigma_i^2``.

    ``s`` may be ``(r,)`` or ``(C, r)``. With several channels one shared ``k``
    is chosen from the energy summed over channels. ``total`` defaults to the
    energy of ``s`` itself. Pass ``||A||_F^2`` when ``s`` is truncated.
    """
    if not 0 < energy <= 1:
        raise ValueError("energy must be in (0, 1]")
    sq = np.atleast_2d(np.asarray(s, dtype=float) ** 2).sum(axis=0)
    total = sq.sum() if total is None else total
    if total == 0:
        return 1
    cumulative = np.cumsum(sq) / total
    return int(min(np.searchsorted(cumulative, energy - 1e-12) + 1, sq.size))


def decompose(img, method="exact", rank=None, seed=0):
    """Compute the SVD of every channel of ``img``.

    ``method="exact"`` runs the batched Jacobi SVD (all ``min(m, n)``
    triplets). ``method="randomized"`` computes only the leading ``rank``
    triplets with the Halko-Martinsson-Tropp algorithm.
    """
    A, gray = to_channels(img)
    if method == "exact":
        U, s, Vt = jacobi_svd(A)
    elif method == "randomized":
        rank = min(A.shape[1:]) if rank is None else rank
        parts = [randomized_svd(ch, rank, seed=seed) for ch in A]
        U, s, Vt = (np.stack(p) for p in zip(*parts))
    else:
        raise ValueError(f"method must be one of {METHODS}")
    return Factors(U, s, Vt, float(np.sum(A ** 2)), gray)


def reconstruct(factors, k):
    """Rank-``k`` image ``A_k = sum_{i<=k} sigma_i u_i v_i^T`` for every channel."""
    k = int(np.clip(k, 1, factors.max_rank))
    stack = (factors.U[:, :, :k] * factors.s[:, None, :k]) @ factors.Vt[:, :k, :]
    return from_channels(stack, factors.gray)


def evaluate(original, approx):
    """Quality metrics for a reconstruction."""
    return {
        "psnr": metrics.psnr(original, approx),
        "ssim": metrics.ssim(original, approx),
        "mse": metrics.mse(original, approx),
        "relative_error": metrics.relative_error(original, approx),
    }


def result_for_rank(img, factors, k):
    """Build a :class:`CompressionResult` for rank ``k`` from precomputed factors."""
    img = as_uint8_image(img)
    k = int(np.clip(k, 1, factors.max_rank))
    out = reconstruct(factors, k)
    m, n = factors.shape
    stats = evaluate(img, out)
    kept = float(np.sum(factors.s[:, :k] ** 2))
    stats["energy"] = kept / factors.energy_total if factors.energy_total else 1.0
    return CompressionResult(out, k, storage_cost(m, n, k, factors.channels), img.size, stats)


def compress(img, k=None, energy=None, method="exact", rank_budget=None, seed=0):
    """Compress ``img`` with a global rank chosen directly (``k``) or by ``energy``.

    Exactly one of ``k`` and ``energy`` must be given. For the randomized
    method the SVD is computed up to ``rank_budget`` triplets (default
    ``k``, or ``min(m, n, 200)`` for an energy target).
    """
    if (k is None) == (energy is None):
        raise ValueError("give exactly one of k or energy")
    img = as_uint8_image(img)
    if k is not None and k < 1:
        raise ValueError("k must be >= 1")
    if method == "randomized" and rank_budget is None:
        rank_budget = min(k if k is not None else 200, *img.shape[:2])
    factors = decompose(img, method, rank=rank_budget, seed=seed)
    if energy is not None:
        k = rank_for_energy(factors.s, energy, factors.energy_total)
    return result_for_rank(img, factors, k)


def _tiles(length, block):
    return [(start, min(start + block, length)) for start in range(0, length, block)]


def compress_blocks(img, block=32, energy=0.95):
    """Adaptive block-wise SVD: busy tiles get more rank, flat tiles almost none.

    1. Cut the image into ``block x block`` tiles (smaller at the edges) and
       subtract each tile's per-channel mean, which is stored as one number.
    2. Decompose every centred tile exactly. Tiles of equal shape are one
       batch.
    3. Allocate ranks globally. Pool the squared singular values of all tiles
       and keep the largest until ``energy`` of the total *detail* energy
       ``sum_t ||T_t - mean_t||_F^2`` is retained. Within a tile the kept values
       are always a prefix, so tile ``t`` gets rank ``k_t`` (possibly 0).

    Storage per tile is ``C * (1 + k_t (b_h + b_w + 1))``.
    """
    if block < 1:
        raise ValueError("block must be >= 1")
    if not 0 < energy <= 1:
        raise ValueError("energy must be in (0, 1]")
    img = as_uint8_image(img)
    A, gray = to_channels(img)
    C, m, n = A.shape
    row_tiles, col_tiles = _tiles(m, block), _tiles(n, block)

    groups = {}
    for i, (r0, r1) in enumerate(row_tiles):
        for j, (c0, c1) in enumerate(col_tiles):
            groups.setdefault((r1 - r0, c1 - c0), []).append((i, j, r0, r1, c0, c1))
    decomposed = []
    for (bh, bw), tiles in groups.items():
        batch = np.stack([A[:, r0:r1, c0:c1] for _, _, r0, r1, c0, c1 in tiles])  # (T, C, bh, bw)
        means = batch.mean(axis=(2, 3), keepdims=True)
        U, s, Vt = jacobi_svd(batch - means)
        decomposed.append(((bh, bw), tiles, means, U, s, Vt, (s ** 2).sum(axis=1)))  # energy per index

    pooled = np.sort(np.concatenate([e.ravel() for *_, e in decomposed]))[::-1]
    detail = pooled.sum()
    if detail > 0:
        cut = np.searchsorted(np.cumsum(pooled) / detail, energy - 1e-12)
        threshold = pooled[min(cut, pooled.size - 1)]
    else:
        threshold = np.inf

    out = np.empty_like(A)
    ranks = np.zeros((len(row_tiles), len(col_tiles)), dtype=int)
    stored, kept = 0, 0.0
    for (bh, bw), tiles, means, U, s, Vt, e in decomposed:
        ks = np.where(e > 0, e >= threshold, False).sum(axis=1)
        keep = (np.arange(s.shape[-1]) < ks[:, None, None]) * s  # zero the dropped sigmas
        approx = (U * keep[:, :, None, :]) @ Vt + means
        for (i, j, r0, r1, c0, c1), tile, k in zip(tiles, approx, ks):
            out[:, r0:r1, c0:c1] = tile
            ranks[i, j] = k
        stored += int(storage_cost(bh, bw, ks, C).sum()) + C * len(tiles)
        kept += float(np.sum(keep ** 2))

    image = from_channels(out, gray)
    stats = evaluate(img, image)
    total = float(np.sum(A ** 2))
    stats["energy"] = 1.0 - float(np.sum((A - out) ** 2)) / total if total else 1.0
    stats["detail_energy"] = kept / detail if detail > 0 else 1.0
    stats["mean_rank"] = float(ranks.mean())
    return CompressionResult(image, ranks, stored, img.size, stats)
