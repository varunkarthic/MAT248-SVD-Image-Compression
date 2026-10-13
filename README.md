# SVD Image Compression

[![CI](https://github.com/varunkarthic/MAT248-SVD-Image-Compression/actions/workflows/ci.yml/badge.svg)](https://github.com/varunkarthic/MAT248-SVD-Image-Compression/actions/workflows/ci.yml)
[![Documentation](https://readthedocs.org/projects/mat248-svd-image-compression/badge/?version=latest)](https://mat248-svd-image-compression.readthedocs.io/en/latest/)
[![Python](https://img.shields.io/badge/python-3.10%20%7C%203.11%20%7C%203.12%20%7C%203.13-blue?logo=python&logoColor=white)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![NumPy](https://img.shields.io/badge/numpy-arrays%20only-013243?logo=numpy)](https://numpy.org/)
[![Flask](https://img.shields.io/badge/flask-web%20UI-000000?logo=flask)](https://flask.palletsprojects.com/)
[![No PIL](https://img.shields.io/badge/PIL%20%2F%20linalg-not%20used-critical)](tests/test_purity.py)

Compress images by keeping only the most important **layers** of their Singular
Value Decomposition. Everything mathematical is written from scratch: the SVD
algorithms, the QR factorisation, the quality metrics and the PNG/BMP/PNM
codecs. NumPy is used only for array arithmetic. Built for **MAT248**.

$$
A = \sum_{i=1}^{r} \sigma_i\, u_i v_i^{T}
\quad\longrightarrow\quad
A_k = \sum_{i=1}^{k} \sigma_i\, u_i v_i^{T},
\qquad
\text{storage: } k(m+n+1) \text{ instead of } mn .
$$

By the **Eckart–Young theorem**, $A_k$ is the best rank-$k$ approximation of
$A$, and its error is exactly the discarded singular values:
$\lVert A-A_k\rVert_F^2 = \sum_{i>k}\sigma_i^2$.

## Features

| Area | What is implemented |
| --- | --- |
| **Linear algebra** (`svdcomp.linalg`) | Householder QR · one-sided Jacobi SVD (round-robin parallel ordering, QR preconditioning, batched over channels/tiles) · randomized SVD (Halko–Martinsson–Tropp, power iterations) |
| **Compression** (`svdcomp.compress`) | Global rank-$k$ · rank from an energy target · adaptive block-wise SVD with mean-centred tiles and a globally optimal rank allocation · storage and compression-ratio accounting |
| **Metrics** (`svdcomp.metrics`) | MSE · PSNR · SSIM (Gaussian window) · relative Frobenius error · retained energy |
| **Codecs** (`svdcomp.formats`) | PNG (all colour types, 1–16 bit, CRC checks, all five filters) · BMP (1/4/8/24/32-bit) · PGM/PPM (P2/P3/P5/P6) |
| **CLI** (`svdcomp`) | `compress`, `info`, `benchmark` (CSV) |
| **Web UI** (`svdcomp-web`) | Upload, live rank slider, σ-decay and Eckart–Young error charts, block rank heat map, metrics, PNG download |

## Quick start

```bash
git clone https://github.com/varunkarthic/MAT248-SVD-Image-Compression.git
cd MAT248-SVD-Image-Compression
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

### Command line

```bash
svdcomp compress photo.png out.png -k 50                        # exact Jacobi SVD
svdcomp compress photo.png out.png -k 50 --method randomized    # fast, leading triplets only
svdcomp compress photo.png out.png --energy 0.999               # smallest k keeping 99.9 % energy
svdcomp compress photo.png out.png --blocks 16 --energy 0.95    # adaptive tiles
svdcomp info photo.png --sigma-csv sigma.csv                    # spectrum summary
svdcomp benchmark photo.png --ks 5,10,20,50,100 --csv bench.csv
```

```text
rank k        : 40
stored values : 153,720 / 1,228,800 (ratio 7.99x)
energy kept   : 99.988 %
PSNR          : 41.78 dB
SSIM          : 0.9840
rel. error    : 0.0112
time          : 0.26 s
```

### Web UI

```bash
svdcomp-web            # then open http://127.0.0.1:5000
```

1. Upload an image. PNG, BMP and PPM are decoded by our own codecs; JPEG, WebP
   and GIF are converted to PNG in the browser first.
2. **Global rank k**: compute the SVD once (randomized, or exact up to
   512 × 512), then drag the slider. Each move only re-multiplies the cached
   factors.
3. **Adaptive blocks**: choose a tile size and an energy target, then see the
   rank chosen for every tile.

### Python

```python
from svdcomp.formats import read_image, write_image
from svdcomp.compress import compress, decompose, result_for_rank

img = read_image("photo.png")
result = compress(img, k=50)
print(f"{result.ratio:.1f}x  PSNR {result.metrics['psnr']:.1f} dB  SSIM {result.metrics['ssim']:.3f}")
write_image("photo_k50.png", result.image)

factors = decompose(img, method="randomized", rank=100)   # decompose once…
for k in (10, 25, 50, 100):                                 # …evaluate many ranks
    print(k, result_for_rank(img, factors, k).metrics["psnr"])
```

## Results

512 × 512 grayscale photo, exact SVD (Apple M4):

| k | Stored numbers | Ratio | PSNR (dB) | SSIM |
| ---: | ---: | ---: | ---: | ---: |
| 5 | 5,125 | 51.2× | 27.79 | 0.915 |
| 10 | 10,250 | 25.6× | 33.57 | 0.952 |
| 20 | 20,500 | 12.8× | 40.00 | 0.979 |
| 50 | 51,250 | 5.1× | 48.90 | 0.995 |
| 100 | 102,500 | 2.6× | 56.30 | 0.998 |

At 512 × 512 the exact Jacobi SVD takes 11 s and the randomized SVD
($k = 50$) takes 0.06 s. Full tables are in the
[documentation](https://mat248-svd-image-compression.readthedocs.io/en/latest/results.html).

> **Caveat.** "Stored numbers" counts values, not bytes. Factors stored as
> 32-bit floats take 4× the space of 8-bit pixels unless they are quantised.
> This is one reason plain SVD loses to JPEG in the literature (Jiang, 2025).

## Architecture

```text
 cli.py ─────────┐        ┌──────── web.py + templates/index.html (Flask)
                 ▼        ▼
          compress.py · metrics.py            ← application layer
             │                 │
     linalg.py (QR, Jacobi,    formats.py (PNG, BMP, PNM)   ← core, no cross-dependency
     randomized SVD)
             │                 │
          NumPy ndarray arithmetic · stdlib zlib
```

The rule "no pre-built math or imaging" is enforced by
[`tests/test_purity.py`](tests/test_purity.py). Package code may not import
PIL, SciPy, OpenCV, scikit-image or imageio, and may not call NumPy's `linalg`.
See the
[architecture chapter](https://mat248-svd-image-compression.readthedocs.io/en/latest/architecture.html)
for the data flow and design decisions.

## Documentation

The Sphinx documentation in [`docs/`](docs) covers the mathematics in detail:
the SVD via the spectral theorem, Eckart–Young–Mirsky proofs, Householder QR,
the Jacobi rotation derivation and convergence, randomized SVD error bounds,
optimal block rank allocation, and PSNR/SSIM. To build it locally:

```bash
pip install -e ".[docs]"
sphinx-build -b html docs docs/_build/html
```

To host it on [Read the Docs](https://readthedocs.org/), import this repository
there. [`.readthedocs.yaml`](.readthedocs.yaml) holds the configuration.

## Project layout

```text
svdcomp/
  linalg.py      Householder QR, one-sided Jacobi SVD, randomized SVD
  compress.py    rank-k / energy / adaptive block compression, storage accounting
  metrics.py     MSE, PSNR, SSIM, relative error
  formats.py     PNG, BMP, PGM/PPM codecs
  cli.py         svdcomp command
  web.py         Flask app (svdcomp-web)
  templates/     single-page web UI
tests/           pytest suite (linalg, codecs, compression, web, purity)
docs/            Sphinx sources for Read the Docs
```

## References

- C. Eckart, G. Young. *The approximation of one matrix by another of lower rank*, 1936.
- N. Halko, P.-G. Martinsson, J. A. Tropp. [*Finding structure with randomness*](https://arxiv.org/abs/0909.4061), 2011.
- Z. Drmač, K. Veselić. *New fast and accurate Jacobi SVD algorithm*, 2008.
- Z. Wang et al. *Image quality assessment: from error visibility to structural similarity*, 2004.
- Z. Golpayegani, N. Bouguila. *PatchSVD: A non-uniform SVD-based image compression algorithm*, 2024.
- J. Jiang. *Image compression using singular value decomposition*, 2025.

## License

[MIT](LICENSE)
