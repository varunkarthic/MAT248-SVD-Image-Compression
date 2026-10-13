"""Regenerate the README / documentation figures using only svdcomp itself.

    python scripts/make_figures.py

Source: docs/_static/figures/astronaut.png, which is NASA's photo of astronaut
Eileen Collins (public domain), downscaled to 256 x 256.
"""

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from svdcomp.compress import compress_blocks, decompose, result_for_rank  # noqa: E402
from svdcomp.formats import read_image, write_image  # noqa: E402

FIG = ROOT / "docs" / "_static" / "figures"
KS = [1, 2, 5, 10, 20, 35, 50, 75, 100, 150]
HERO_KS = [5, 20, 50]
COLORS = ["#d64545", "#2f9e44", "#3b6fd8"]
INK = "#8a8f99"  # readable on both light and dark backgrounds


def svg_line_chart(series, colors, title, ylabel, path, marks=()):
    """Log-scale line chart drawn as plain SVG."""
    w, h, l, r, t, b = 640, 300, 64, 16, 36, 44
    logs = [np.log10(np.maximum(s, 1e-12)) for s in series]
    lo = np.floor(min(x.min() for x in logs))
    hi = np.ceil(max(x.max() for x in logs))
    n = len(series[0])
    sx = lambda i: l + i / (n - 1) * (w - l - r)  # noqa: E731
    sy = lambda v: t + (1 - (v - lo) / (hi - lo)) * (h - t - b)  # noqa: E731
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="system-ui, sans-serif" font-size="12">',
           f'<text x="{l}" y="20" fill="{INK}" font-size="14" font-weight="600">{title}</text>']
    for e in range(int(lo), int(hi) + 1):
        y = sy(e)
        out.append(f'<line x1="{l}" x2="{w - r}" y1="{y:.1f}" y2="{y:.1f}" stroke="{INK}" stroke-opacity=".25"/>')
        out.append(f'<text x="{l - 8}" y="{y + 4:.1f}" fill="{INK}" text-anchor="end">1e{e}</text>')
    for i in sorted({0, *(j for j in range(49, n, 50) if n - 1 - j > 20), n - 1}):
        out.append(f'<text x="{sx(i):.1f}" y="{h - b + 18}" fill="{INK}" text-anchor="middle">{i + 1}</text>')
    out.append(f'<text x="{(l + w - r) / 2}" y="{h - 6}" fill="{INK}" text-anchor="middle">index i (rank k)</text>')
    out.append(f'<text transform="translate(14 {(t + h - b) / 2}) rotate(-90)" fill="{INK}" text-anchor="middle">{ylabel}</text>')
    for k in marks:
        x = sx(k - 1)
        out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{t}" y2="{h - b}" stroke="{INK}" stroke-dasharray="4 3"/>')
        out.append(f'<text x="{x + 4:.1f}" y="{t + 12}" fill="{INK}">k={k}</text>')
    for s, c in zip(logs, colors):
        pts = " ".join(f"{sx(i):.1f},{sy(v):.1f}" for i, v in enumerate(s))
        out.append(f'<polyline fill="none" stroke="{c}" stroke-width="2" points="{pts}"/>')
    out.append("</svg>")
    path.write_text("\n".join(out))


def main():
    img = read_image(FIG / "astronaut.png")
    factors = decompose(img)  # exact Jacobi SVD, all 256 triplets per channel

    data = []
    for k in KS:
        res = result_for_rank(img, factors, k)
        write_image(FIG / f"k{k:03d}.png", res.image)
        m = res.metrics
        data.append({"k": k, "src": f"k{k:03d}.png", "ratio": round(res.ratio, 2),
                     "psnr": round(m["psnr"], 2), "ssim": round(m["ssim"], 4),
                     "energy": round(100 * m["energy"], 3)})
    (FIG / "slider.json").write_text(json.dumps(data, indent=1))

    gap = np.full((img.shape[0], 6, 3), 255, np.uint8)
    tiles = [result_for_rank(img, factors, k).image for k in HERO_KS] + [img]
    hero = tiles[0]
    for tile in tiles[1:]:
        hero = np.hstack([hero, gap, tile])
    write_image(FIG / "hero.png", hero)

    svg_line_chart(list(factors.s), COLORS, "Singular values of the R, G, B channels",
                   "σᵢ (log scale)", FIG / "sigma.svg", marks=HERO_KS)
    error = 1 - np.cumsum((factors.s ** 2).sum(axis=0)) / factors.energy_total
    svg_line_chart([error[:-1]], ["#7c5cff"], "Relative squared error of the best rank-k image (Eckart–Young)",
                   "discarded energy (log)", FIG / "error.svg", marks=HERO_KS)

    blocks = compress_blocks(img, block=16, energy=0.95)
    write_image(FIG / "blocks.png", blocks.image)
    ranks = blocks.k / max(blocks.k.max(), 1)
    heat = np.kron(ranks, np.ones((16, 16)))[:img.shape[0], :img.shape[1]]
    light, dark = np.array([238, 242, 255]), np.array([40, 60, 160])
    write_image(FIG / "blocks_ranks.png", light + heat[..., None] * (dark - light))
    (FIG / "blocks.json").write_text(json.dumps({
        "ratio": round(blocks.ratio, 2), "psnr": round(blocks.metrics["psnr"], 2),
        "ssim": round(blocks.metrics["ssim"], 4), "mean_rank": round(blocks.metrics["mean_rank"], 2),
        "max_rank": int(blocks.k.max())}, indent=1))
    print(json.dumps(data, indent=1))


if __name__ == "__main__":
    main()
