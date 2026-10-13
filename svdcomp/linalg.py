"""From-scratch dense linear algebra: Householder QR, Jacobi SVD, randomized SVD.

NumPy is used purely as an array container with vectorised arithmetic; every
factorisation here is implemented directly from its mathematical definition.
"""

import numpy as np


def householder_qr(A):
    """Thin QR factorisation ``A = Q R`` using Householder reflections.

    Parameters
    ----------
    A : array_like, shape (..., m, n)
        A matrix or a stack of matrices.

    Returns
    -------
    Q : ndarray, shape (..., m, p)
        Orthonormal columns, ``p = min(m, n)``.
    R : ndarray, shape (..., p, n)
        Upper triangular.

    Notes
    -----
    Column ``j`` is reflected onto ``-sign(x_0) ||x|| e_1`` with
    ``H = I - 2 v v^T``. The sign choice avoids cancellation when forming
    ``v``. A zero column gives ``v = 0`` (``H = I``). Q is accumulated by
    applying the reflectors to the first ``p`` columns of the identity in
    reverse order.
    """
    R = np.array(A, dtype=float)
    if R.ndim < 2:
        raise ValueError("householder_qr expects at least a 2-D array")
    batch, (m, n) = R.shape[:-2], R.shape[-2:]
    p = min(m, n)
    R = R.reshape((-1, m, n))
    reflectors = []
    for j in range(p):
        x = R[:, j:, j]
        alpha = np.sqrt(np.einsum("bi,bi->b", x, x))
        v = x.copy()
        v[:, 0] += np.where(x[:, 0] >= 0, alpha, -alpha)
        vnorm = np.sqrt(np.einsum("bi,bi->b", v, v))[:, None]
        v = np.where(vnorm > 0, v / np.where(vnorm > 0, vnorm, 1.0), 0.0)
        R[:, j:, j:] -= 2.0 * v[:, :, None] * np.einsum("bi,bij->bj", v, R[:, j:, j:])[:, None, :]
        reflectors.append(v)

    Q = np.broadcast_to(np.eye(m, p), (R.shape[0], m, p)).copy()
    for j in reversed(range(p)):
        v = reflectors[j]
        Q[:, j:, :] -= 2.0 * v[:, :, None] * np.einsum("bi,bij->bj", v, Q[:, j:, :])[:, None, :]
    R = np.triu(R[:, :p])
    return Q.reshape(batch + (m, p)), R.reshape(batch + (p, n))


def _round_robin(n):
    """Rounds of disjoint index pairs covering every pair of ``range(n)`` once.

    Circle method: fix player 0, rotate the others. With ``n`` even there are
    ``n - 1`` rounds of ``n / 2`` pairs; an odd ``n`` gets a dummy player.
    """
    players = list(range(n + n % 2))
    N = len(players)
    rounds = []
    for _ in range(N - 1):
        pairs = [(players[i], players[N - 1 - i]) for i in range(N // 2)]
        pairs = [(min(a, b), max(a, b)) for a, b in pairs if a < n and b < n]
        if pairs:
            rounds.append(np.array(pairs).T)
        players = [players[0], players[-1]] + players[1:-1]
    return rounds


def jacobi_svd(A, tol=1e-10, max_sweeps=60):
    """Singular value decomposition by one-sided (Hestenes) Jacobi rotations.

    The matrix is first reduced with a QR factorisation ``A = Q R``. One-sided
    Jacobi then runs on ``R^T``, which is square and better scaled, so it
    converges in roughly half the sweeps (Drmac & Veselic, 2008). Jacobi
    repeatedly rotates pairs of columns ``(p, q)`` of ``W = X V`` until all
    columns are mutually orthogonal. Then ``sigma_i = ||w_i||``,
    ``u_i = w_i / sigma_i`` and ``X = U diag(sigma) V^T``.

    Parameters
    ----------
    A : array_like, shape (..., m, n)
        A matrix or a stack of matrices (e.g. colour channels or image tiles),
        all decomposed simultaneously.
    tol : float
        A pair is treated as orthogonal once
        ``|w_p . w_q| <= tol * ||w_p|| ||w_q||``.
    max_sweeps : int
        Safety cap on full passes over all column pairs.

    Returns
    -------
    U : ndarray, shape (..., m, r)
    s : ndarray, shape (..., r)   -- non-negative, descending
    Vt : ndarray, shape (..., r, n)
        with ``r = min(m, n)``. Singular vectors paired with an exactly zero
        singular value may be zero vectors. They never contribute to ``A_k``.
    """
    A = np.asarray(A, dtype=float)
    if A.ndim < 2:
        raise ValueError("jacobi_svd expects at least a 2-D array")
    m, n = A.shape[-2:]
    if m < n:  # work on the tall matrix: A^T = V S U^T
        U, s, Vt = jacobi_svd(np.swapaxes(A, -1, -2), tol, max_sweeps)
        return np.swapaxes(Vt, -1, -2), s, np.swapaxes(U, -1, -2)
    Q, R = householder_qr(A)
    # R^T = Ur S Vrt  =>  A = Q R = (Q Vrt^T) S Ur^T
    Ur, s, Vrt = _jacobi_tall(np.swapaxes(R, -1, -2), tol, max_sweeps)
    return Q @ np.swapaxes(Vrt, -1, -2), s, np.swapaxes(Ur, -1, -2)


def _jacobi_tall(A, tol, max_sweeps):
    """One-sided Jacobi core for a stack of matrices with ``m >= n``."""
    m, n = A.shape[-2:]
    batch = A.shape[:-2]
    # Store columns as rows (W[b, j, :] is column j) so pair access is contiguous.
    W = np.swapaxes(A, -1, -2).reshape((-1, n, m)).copy()
    V = np.broadcast_to(np.eye(n), (W.shape[0], n, n)).copy()  # rows = columns of V
    rounds = _round_robin(n)

    for _ in range(max_sweeps):
        rotated = False
        for p, q in rounds:
            Wp, Wq = W[:, p, :], W[:, q, :]
            alpha = np.einsum("bij,bij->bi", Wp, Wp)
            beta = np.einsum("bij,bij->bi", Wq, Wq)
            gamma = np.einsum("bij,bij->bi", Wp, Wq)
            active = np.abs(gamma) > tol * np.sqrt(alpha * beta)
            if not active.any():
                continue
            rotated = True
            # Solve t^2 + 2 zeta t - 1 = 0 for the smaller root (|angle| <= pi/4).
            g = np.where(active, gamma, 1.0)
            zeta = (beta - alpha) / (2.0 * g)
            t = np.where(zeta >= 0, 1.0, -1.0) / (np.abs(zeta) + np.sqrt(1.0 + zeta * zeta))
            t = np.where(active, t, 0.0)
            c = 1.0 / np.sqrt(1.0 + t * t)
            s = (c * t)[..., None]
            c = c[..., None]
            W[:, p, :], W[:, q, :] = c * Wp - s * Wq, s * Wp + c * Wq
            Vp, Vq = V[:, p, :], V[:, q, :]
            V[:, p, :], V[:, q, :] = c * Vp - s * Vq, s * Vp + c * Vq
        if not rotated:
            break

    sigma = np.sqrt(np.einsum("bij,bij->bi", W, W))
    order = np.argsort(-sigma, axis=-1, kind="stable")
    sigma = np.take_along_axis(sigma, order, axis=-1)
    W = np.take_along_axis(W, order[..., None], axis=1)
    V = np.take_along_axis(V, order[..., None], axis=1)
    safe = np.where(sigma > 0, sigma, 1.0)[..., None]
    U = np.where(sigma[..., None] > 0, W / safe, 0.0)

    U = np.swapaxes(U, -1, -2).reshape(batch + (m, n))
    return U, sigma.reshape(batch + (n,)), V.reshape(batch + (n, n))


def randomized_svd(A, k, oversample=10, power_iters=2, seed=None):
    """Approximate rank-``k`` SVD (Halko, Martinsson & Tropp, 2011).

    1. Draw a Gaussian test matrix ``Omega`` (n x l), ``l = k + oversample``.
    2. Form ``Y = (A A^T)^q A Omega`` with re-orthonormalisation between steps,
       and ``Q = qr(Y)`` -- an orthonormal basis approximating range(A).
    3. Compute the small SVD ``Q^T A = U_B S V^T`` exactly (Jacobi).
    4. Return ``U = Q U_B`` truncated to ``k`` terms.

    Parameters
    ----------
    A : array_like, shape (m, n)
    k : int
        Target rank, ``1 <= k <= min(m, n)``.
    oversample : int
        Extra sample vectors ``p``; 5-10 is usually enough.
    power_iters : int
        Subspace iterations ``q``; each sharpens the decay of the spectrum
        seen by the sampler from ``sigma_j`` to ``sigma_j^(2q+1)``.
    seed : int or None
        Seed for reproducible results.
    """
    A = np.asarray(A, dtype=float)
    if A.ndim != 2:
        raise ValueError("randomized_svd expects a 2-D matrix")
    m, n = A.shape
    if not 1 <= k <= min(m, n):
        raise ValueError(f"k must be in [1, {min(m, n)}], got {k}")
    l = min(k + oversample, m, n)
    rng = np.random.default_rng(seed)
    Q, _ = householder_qr(A @ rng.standard_normal((n, l)))
    for _ in range(power_iters):
        Q, _ = householder_qr(A.T @ Q)
        Q, _ = householder_qr(A @ Q)
    Ub, s, Vt = jacobi_svd(Q.T @ A)
    return (Q @ Ub)[:, :k], s[:k], Vt[:k]
