"""Image quality metrics implemented with NumPy array arithmetic only."""

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view


def _pair(original, approx):
    a = np.asarray(original, dtype=float)
    b = np.asarray(approx, dtype=float)
    if a.shape != b.shape:
        raise ValueError(f"shape mismatch: {a.shape} vs {b.shape}")
    return a, b


def mse(original, approx):
    """Mean squared error, ``(1 / N) * sum (a - b)^2``."""
    a, b = _pair(original, approx)
    return float(np.mean((a - b) ** 2))


def psnr(original, approx, peak=255.0):
    """Peak signal-to-noise ratio in dB, ``10 log10(peak^2 / MSE)``; ``inf`` when identical."""
    err = mse(original, approx)
    return float("inf") if err == 0 else float(10.0 * np.log10(peak ** 2 / err))


def relative_error(original, approx):
    """Relative Frobenius error ``||A - B||_F / ||A||_F``."""
    a, b = _pair(original, approx)
    denom = np.sqrt(np.sum(a ** 2))
    return 0.0 if denom == 0 else float(np.sqrt(np.sum((a - b) ** 2)) / denom)


def _gaussian_kernel(size, sigma):
    x = np.arange(size) - (size - 1) / 2.0
    k = np.exp(-x ** 2 / (2.0 * sigma ** 2))
    return k / k.sum()


def _blur(x, kernel):
    """Separable 'valid' convolution of a 2-D array with a symmetric 1-D kernel."""
    x = sliding_window_view(x, kernel.size, axis=1) @ kernel
    return sliding_window_view(x, kernel.size, axis=0) @ kernel


def ssim(original, approx, peak=255.0, window=11, sigma=1.5):
    """Structural similarity index (Wang et al., 2004), averaged over channels.

    ``SSIM(x, y) = ((2 mu_x mu_y + C1)(2 sigma_xy + C2)) /
    ((mu_x^2 + mu_y^2 + C1)(sigma_x^2 + sigma_y^2 + C2))`` with local
    statistics from a Gaussian window, ``C1 = (0.01 L)^2``, ``C2 = (0.03 L)^2``.
    """
    a, b = _pair(original, approx)
    if a.ndim == 2:
        a, b = a[:, :, None], b[:, :, None]
    size = min(window, a.shape[0], a.shape[1])
    kernel = _gaussian_kernel(size, sigma)
    c1, c2 = (0.01 * peak) ** 2, (0.03 * peak) ** 2
    scores = []
    for ch in range(a.shape[2]):
        x, y = a[:, :, ch], b[:, :, ch]
        mx, my = _blur(x, kernel), _blur(y, kernel)
        vx = _blur(x * x, kernel) - mx * mx
        vy = _blur(y * y, kernel) - my * my
        cxy = _blur(x * y, kernel) - mx * my
        smap = ((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx ** 2 + my ** 2 + c1) * (vx + vy + c2))
        scores.append(smap.mean())
    return float(np.mean(scores))
