"""Deterministic demonstration images and their manifest.

Run ``python -m svdcomp.samples`` to (re)generate ``svdcomp/demo_assets``. Every
synthetic image is produced from closed-form formulas or a fixed random seed, so the
files are reproducible. The two photographs are derived from the public-domain NASA
astronaut portrait already used in the documentation.
"""

import json
from pathlib import Path

import numpy as np

from .formats import encode_png, read_image

ASSETS = Path(__file__).parent / "demo_assets"
SAMPLES = ASSETS / "samples"
PHOTO = Path(__file__).resolve().parents[1] / "docs" / "_static" / "figures" / "astronaut.png"


def _u8(a):
    return np.clip(np.rint(a), 0, 255).astype(np.uint8)


def gradient():
    y, x = np.mgrid[0:256, 0:256] / 255.0
    return _u8(255 * (0.55 * x + 0.45 * y))


def checkerboard():
    y, x = np.mgrid[0:256, 0:256]
    return _u8(255 * (((x // 32) + (y // 32)) % 2))


def shapes():
    y, x = np.mgrid[0:256, 0:256].astype(float)
    img = 40 + 40 * (x / 255)
    img[(x - 90) ** 2 + (y - 100) ** 2 < 55 ** 2] = 230
    img[150:230, 140:230] = 120
    tri = (y > 40) & (y < 130) & (np.abs(x - 190) < (y - 40) * 0.6)
    img[tri] = 200
    return _u8(img)


def edges():
    y, x = np.mgrid[0:256, 0:256]
    stripes = ((x + y) // 12) % 2
    grid = ((x % 64) < 3) | ((y % 64) < 3)
    ring = (np.hypot(x - 128, y - 128) // 10) % 2
    return _u8(255 * np.where(grid, 1.0, np.where(x > 128, ring, stripes)))


def low_rank():
    """Rank-5 matrix (before 8-bit rounding), 256 x 192: four separable cosine terms plus a constant offset."""
    y = np.linspace(0, 1, 256)[:, None]
    x = np.linspace(0, 1, 192)[None, :]
    weights = [1.0, 0.75, 0.55, 0.4]
    a = sum(w * np.cos(i * np.pi * y) * np.cos((5 - i) * np.pi * x)
            for i, w in enumerate(weights, start=1))
    return _u8(255 * (a - a.min()) / (a.max() - a.min()))


def texture():
    rng = np.random.default_rng(248)
    noise = rng.normal(size=(256, 256))
    fx = np.fft.fftfreq(256)[None, :]
    fy = np.fft.fftfreq(256)[:, None]
    spectrum = np.fft.fft2(noise) / (np.hypot(fx, fy) + 0.02) ** 1.2   # 1/f^p noise: detail at all scales
    a = np.real(np.fft.ifft2(spectrum))
    return _u8(255 * (a - a.min()) / (a.max() - a.min()))


def tiny_face():
    rows = ["................", "....########....", "...##########...", "..############..", ".##############.",
            ".##..######..##.", ".##..######..##.", ".##############.", ".##############.", ".##.########.##.",
            ".###.######.###.", "..####....####..", "..############..", "...##########...", "....########....",
            "................"]
    return _u8(np.array([[220 if c == "." else 30 for c in r] for r in rows], dtype=float))


def photo_color():
    return read_image(PHOTO)


def photo_gray():
    rgb = photo_color().astype(float)
    return _u8(rgb @ np.array([0.299, 0.587, 0.114]))


# id, generator, title, description, why it is interesting for SVD
CATALOG = [
    ("gradient", gradient, "Smooth gradient",
     "A grayscale ramp that brightens from top-left to bottom-right.",
     "Every entry is a linear function of (row, column), so the matrix has rank 2: two singular components rebuild it almost exactly."),
    ("checkerboard", checkerboard, "Checkerboard",
     "An 8 x 8 board of black and white squares.",
     "Repeated structure means low rank: the board is exactly rank 2 (a +/- pattern outer-multiplied by another), despite its hard edges."),
    ("shapes", shapes, "Geometric shapes",
     "A circle, a rectangle and a triangle on a shaded background.",
     "Axis-aligned blocks are cheap; diagonals and curves need more components, so you can watch the edges sharpen as k grows."),
    ("edges", edges, "Edge-heavy pattern",
     "Diagonal stripes, a grid and concentric rings.",
     "Diagonal and circular edges are not aligned with rows and columns, so the singular values decay slowly."),
    ("low-rank", low_rank, "Low-rank construction",
     "A 256 x 192 image: four separable cosine patterns plus a constant brightness offset.",
     "Before 8-bit rounding the rank is exactly 5: the spectrum drops to rounding-noise level after sigma_5, and k = 5 is already nearly perfect."),
    ("texture", texture, "Complex texture",
     "Fractal 1/f noise with detail at every scale.",
     "Nothing here is low rank. The spectrum decays slowly, which shows where truncated SVD stops being a good compressor."),
    ("tiny-face", tiny_face, "Tiny 16 x 16 face",
     "A 16 x 16 pixel face, small enough to print the whole matrix.",
     "Small enough for the exact SVD in a blink, and the pixel-to-matrix correspondence can be read entry by entry."),
    ("photo-gray", photo_gray, "Photograph (grayscale)",
     "NASA's portrait of astronaut Eileen Collins (public domain), converted to luminance, 256 x 256.",
     "A natural image: a few components capture the large light/dark layout, and fine detail arrives slowly."),
    ("photo-color", photo_color, "Photograph (colour)",
     "The same public-domain NASA portrait in RGB, 256 x 256.",
     "Colour means three matrices (R, G, B) decomposed separately, so the storage count is three times larger."),
]


def build(out=SAMPLES):
    """Write every sample PNG and ``manifest.json``; returns the manifest list."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for sid, make, title, description, why in CATALOG:
        img = make()
        (out / f"{sid}.png").write_bytes(encode_png(img))
        manifest.append({
            "id": sid, "title": title, "file": f"{sid}.png", "description": description, "why": why,
            "height": int(img.shape[0]), "width": int(img.shape[1]),
            "channels": 1 if img.ndim == 2 else int(img.shape[2]),
        })
    (out.parent / "manifest.json").write_text(json.dumps({"samples": manifest}, indent=2) + "\n", encoding="utf8")
    return manifest


def load_manifest():
    return json.loads((ASSETS / "manifest.json").read_text(encoding="utf8"))["samples"]


if __name__ == "__main__":
    for item in build():
        print(item["id"], item["width"], "x", item["height"])
