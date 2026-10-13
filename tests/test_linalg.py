import itertools

import numpy as np
import pytest

from svdcomp.linalg import _round_robin, householder_qr, jacobi_svd, randomized_svd

rng = np.random.default_rng(0)


def check_svd(A, U, s, Vt, atol=1e-9):
    r = min(A.shape[-2:])
    assert U.shape[-2:] == (A.shape[-2], r) and Vt.shape[-2:] == (r, A.shape[-1])
    assert np.all(s >= 0) and np.all(np.diff(s, axis=-1) <= 1e-12)
    np.testing.assert_allclose((U * s[..., None, :]) @ Vt, A, atol=atol)
    np.testing.assert_allclose(np.swapaxes(U, -1, -2) @ U, np.broadcast_to(np.eye(r), U.shape[:-2] + (r, r)), atol=atol)


@pytest.mark.parametrize("n", [1, 2, 5, 8, 13])
def test_round_robin_covers_every_pair_once(n):
    seen = [tuple(pq) for rnd in _round_robin(n) for pq in rnd.T]
    assert sorted(seen) == list(itertools.combinations(range(n), 2))
    for rnd in _round_robin(n):  # pairs within a round are disjoint
        assert len(set(rnd.ravel())) == rnd.size


@pytest.mark.parametrize("shape", [(6, 4), (4, 6), (5, 5), (30, 1), (1, 7)])
def test_householder_qr(shape):
    A = rng.standard_normal(shape)
    Q, R = householder_qr(A)
    p = min(shape)
    np.testing.assert_allclose(Q.T @ Q, np.eye(p), atol=1e-12)
    np.testing.assert_allclose(Q @ R, A, atol=1e-12)
    assert np.allclose(R, np.triu(R))


def test_householder_qr_rank_deficient():
    A = np.outer(np.arange(1.0, 7), [1.0, 2.0, 3.0])
    A[:, 1] = 0
    Q, R = householder_qr(A)
    np.testing.assert_allclose(Q @ R, A, atol=1e-12)


@pytest.mark.parametrize("shape", [(8, 5), (5, 8), (7, 7), (40, 25), (1, 6), (6, 1)])
def test_jacobi_matches_reference(shape):
    A = rng.standard_normal(shape)
    U, s, Vt = jacobi_svd(A)
    check_svd(A, U, s, Vt)
    np.testing.assert_allclose(Vt @ Vt.T, np.eye(min(shape)), atol=1e-9)
    np.testing.assert_allclose(s, np.linalg.svd(A, compute_uv=False), atol=1e-10)


def test_jacobi_closed_form_and_zero():
    s = jacobi_svd(np.diag([3.0, -5.0, 1.0]))[1]
    np.testing.assert_allclose(s, [5, 3, 1])
    U, s, Vt = jacobi_svd(np.zeros((4, 3)))
    assert np.all(s == 0) and np.all(np.isfinite(U))


def test_jacobi_rank_deficient():
    A = rng.standard_normal((10, 3)) @ rng.standard_normal((3, 8))
    U, s, Vt = jacobi_svd(A)
    check_svd(A, U, s, Vt)
    assert np.all(s[3:] < 1e-8)


def test_jacobi_batched_equals_individual():
    stack = rng.standard_normal((3, 2, 9, 6))
    U, s, Vt = jacobi_svd(stack)
    check_svd(stack, U, s, Vt)
    np.testing.assert_allclose(s[1, 0], jacobi_svd(stack[1, 0])[1], atol=1e-12)


def test_randomized_svd_near_optimal():
    # Matrix with fast spectral decay; Eckart-Young gives the optimal error.
    X, _ = householder_qr(rng.standard_normal((120, 60)))
    Y, _ = householder_qr(rng.standard_normal((80, 60)))
    sig = 0.7 ** np.arange(60)
    A = (X * sig) @ Y.T
    k = 10
    U, s, Vt = randomized_svd(A, k, seed=1)
    err = np.sqrt(np.sum((A - (U * s) @ Vt) ** 2))
    optimal = np.sqrt(np.sum(sig[k:] ** 2))
    assert err <= 1.01 * optimal
    np.testing.assert_allclose(s, sig[:k], rtol=1e-6)


def test_randomized_svd_rejects_bad_rank():
    with pytest.raises(ValueError):
        randomized_svd(np.ones((4, 4)), 5)


def test_inputs_are_not_modified():
    A = rng.standard_normal((5, 8))
    before = A.copy()
    jacobi_svd(A.T)
    householder_qr(A)
    np.testing.assert_array_equal(A, before)


def test_householder_qr_batched():
    stack = rng.standard_normal((4, 7, 5))
    Q, R = householder_qr(stack)
    np.testing.assert_allclose(Q @ R, stack, atol=1e-12)
