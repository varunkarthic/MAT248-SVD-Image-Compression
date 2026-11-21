# SVD LAB: presentation and viva guide

A guide for a 30–45 minute live demonstration of *Image compression using the SVD*. It does not assume a team size:
the sections below are numbered handoff points, so give consecutive sections to consecutive speakers.
Every person should be able to explain every formula in their own section **and** the section before and after it.

Reference assigned for the course: <https://arxiv.org/html/2512.16226v1>

## 0. Before the session (10 minutes, the day before)

```powershell
git clone https://github.com/varunkarthic/MAT248-SVD-Image-Compression
cd MAT248-SVD-Image-Compression
py -m venv .venv ; .\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
pytest -q                       # everything green on this machine?
svdcomp-web                     # then open http://127.0.0.1:5000
```

* Everything runs locally and offline. Turn Wi-Fi off once as a rehearsal: nothing should change.
* Press **Presentation mode** (header) to enlarge type and enable the guided panel (PageDown / PageUp move through the ten steps; Esc leaves).
* Use **Details: on/off** to switch between the simple explanation and the full mathematical statements.
* Keep three images ready: the bundled *Checkerboard* (rank 2), *Photograph (grayscale)* and one image you uploaded yourself.
* The first SVD of a 256 × 256 image with the *exact* method takes a few seconds; the randomized method is nearly instant. Compute it **before** you start talking about the next slide.

## 1. Suggested timeline (40 minutes + questions)

| Min | Section | Speaker handoff | Page area |
| --- | --- | --- | --- |
| 0–3 | 1. Motivation: an image is a matrix | 1 | Hero, Learn ch. 1–4 |
| 3–8 | 2. Tools: multiplication, rank, transpose, eigenvalues | 1 or 2 | Learn ch. 5–9 |
| 8–15 | 3. The SVD and the 2 × 2 board calculation | 2 | Worked example (board mode) |
| 15–18 | 4. Rank-k approximation, Eckart–Young, energy | 2 or 3 | Learn ch. 12–15, Mathematics D–E |
| 18–28 | 5. Live demo on real images | 3 | Laboratory |
| 28–33 | 6. Exact vs randomized, adaptive blocks | 4 | Mathematics H, Laboratory, Adaptive tab |
| 33–37 | 7. Honest metrics and limitations | 4 or 1 | Results panel, Mathematics F–G |
| 37–40 | 8. Conclusion | last | Summary |

With two speakers merge sections (1+2, 3+4+5, 6+7+8). With five or more, split section 5 (upload / animation / charts).

## 2. What must be stated (the checklist)

1. A grayscale image is an m × n matrix of integers 0–255; colour is three such matrices (R, G, B) processed separately.
2. Every real m × n matrix factors as **A = U Σ Vᵀ** with U (m × m) and V (n × n) orthogonal and Σ (m × n) diagonal with σ₁ ≥ σ₂ ≥ … ≥ 0.
3. The σᵢ are the square roots of the eigenvalues of AᵀA; the columns of V are its eigenvectors; uᵢ = A vᵢ / σᵢ for σᵢ > 0.
4. **A = Σᵢ σᵢ uᵢ vᵢᵀ** (sum of rank-one matrices), and **A_k = Σ_{i≤k} σᵢ uᵢ vᵢᵀ** is the rank-k truncation.
5. **Eckart–Young–Mirsky:** among all matrices of rank at most k, A_k minimises ‖A − B‖_F (and ‖A − B‖₂). For the exact SVD, ‖A − A_k‖_F² = Σ_{i>k} σᵢ² and ‖A − A_k‖₂ = σ_{k+1}.
6. Retained energy E(k) = Σ_{i≤k} σᵢ² / Σᵢ σᵢ² = 1 − ‖A − A_k‖_F² / ‖A‖_F².
7. Storing k triplets costs **k(m + n + 1)** numbers per channel, against m·n. This is a *count of numbers*, not a file size.
8. The randomized SVD is an approximation to the leading triplets; it does not always equal the optimal A_k.
9. Limitations: PNG of a reconstruction is not an SVD file; JPEG/WebP generally beat plain SVD in bytes; adaptive blocks add complexity and can show tile edges.

## 3. Board work: the 2 × 2 example (7 minutes)

Write this on the board while the page's *Board mode* reveals the same lines. Let the audience predict each result.

**Given** A = [[3, 1], [1, 3]].

1. AᵀA = [[10, 6], [6, 10]]. (A is symmetric, so AᵀA = A².) Check: first row of Aᵀ times first column of A is 3·3 + 1·1 = 10; and 3·1 + 1·3 = 6.
2. det(AᵀA − λI) = (10 − λ)² − 36 = λ² − 20λ + 64 = (λ − 16)(λ − 4). Eigenvalues **16** and **4**.
3. λ = 16: (AᵀA − 16I)v = 0 gives −6x + 6y = 0, so v₁ = (1, 1)/√2. λ = 4: 6x + 6y = 0, so v₂ = (1, −1)/√2.
4. Singular values σ₁ = √16 = **4**, σ₂ = √4 = **2**.
5. u₁ = A v₁ / σ₁ = (4, 4)/√2 / 4 = (1, 1)/√2. u₂ = A v₂ / σ₂ = (2, −2)/√2 / 2 = (1, −1)/√2. So U = V = (1/√2)[[1, 1], [1, −1]].
6. Σ = [[4, 0], [0, 2]]. Verify: UΣ = (1/√2)[[4, 2], [4, −2]]; multiplying by Vᵀ = (1/√2)[[1, 1], [1, −1]] gives (1/2)[[4+2, 4−2], [4−2, 4+2]] = [[3, 1], [1, 3]] = A ✓.
7. **Rank 1:** A₁ = σ₁u₁v₁ᵀ = 4 · ½ [[1, 1], [1, 1]] = **[[2, 2], [2, 2]]**.
8. **Residual:** A − A₁ = [[1, −1], [−1, 1]], ‖A − A₁‖_F = √(1+1+1+1) = **2** = σ₂ ✓ (Eckart–Young).
9. **Energy:** ‖A‖_F² = 9+1+1+9 = 20 = 16 + 4. E(1) = 16/20 = **0.8 = 80 %**.
10. **Rank 2:** add σ₂u₂v₂ᵀ = 2 · ½ [[1, −1], [−1, 1]] = [[1, −1], [−1, 1]]. A₁ + that = A. Error 0, energy 100 %.
11. *Honest remark:* storing the rank-1 factors takes 1·(2+2+1) = 5 numbers, more than the 4 entries of A. The example teaches the mathematics; storage savings appear for large images (e.g. 256 × 256: 513 numbers per rank against 65 536 entries).

Extra insight if asked: for a symmetric positive-definite matrix the singular values equal the eigenvalues of A itself (4 and 2 here), and U = V.

## 4. Live demonstration sequence (10 minutes)

1. *Optionally* press **Skip intro** (or **Replay intro**, 3 seconds, if the room is waiting).
2. **Gallery → Checkerboard.** Method *Exact*, **Compute SVD**. Show the spectrum: only two non-zero singular values. Set k = 2: the reconstruction is (almost) exact. Say: "repeated structure means low rank".
3. **Gallery → Photograph (grayscale).** Method *Exact* (or *Randomized*, rank budget 150), **Compute SVD**.
4. Press **Play**. Say what is happening: each frame is the real rank-k sum; the equation, the rank, the highlighted singular-value bars and the energy all refer to the *same* k. **Pause** around k = 5, 20, 50.
5. Type an exact rank into the box (e.g. 35). Drag the comparison divider; show **Difference** to see where the error lives.
6. Turn on **Show component**: the signed rank-one image σᵢuᵢvᵢᵀ (cobalt negative, vermilion positive). Say it is not a photograph by itself.
7. Read the **energy** and **error** charts: where does E(k) pass 90 %? 99 %?
8. **Results:** read PSNR, SSIM, relative error, scalar count k(m+n+1), the PNG byte count of the *reconstruction*. Stress that the ratio is a scalar-count ratio.
9. **Gallery → Complex texture:** the spectrum decays slowly; low rank is a poor fit. Contrast it with the checkerboard.
10. **Upload your own image** (JPEG/WebP are converted to PNG in the browser and say so).
11. **Tiny 16 × 16 face:** exact SVD in an instant; link back to the matrix of numbers.
12. **Adaptive blocks tab** on *Geometric shapes*: tile 16, energy 95 %. Explain the rank heat-map: flat tiles need ~0, edges need more.
13. Finish on **Summary**.

## 5. Possible examiner questions, with short correct answers

**Why is σᵢ = √(eigenvalue of AᵀA)?** Because AᵀA = V Σᵀ Σ Vᵀ, so its eigenvalues are σᵢ² with eigenvectors vᵢ; AᵀA is symmetric positive semidefinite, so the eigenvalues are real and ≥ 0.

**Why are singular values listed in descending order?** It is a convention that makes the truncation A_k keep the biggest terms; by Eckart–Young those are exactly the ones that minimise the error.

**State Eckart–Young–Mirsky.** For A of rank r and k < r, min over rank(B) ≤ k of ‖A − B‖_F equals √(Σ_{i>k} σᵢ²), attained by A_k; in the 2-norm the minimum is σ_{k+1}.

**Why are rank-k images "best" only in the Frobenius/2-norm?** Optimality is for those matrix norms, not for human perception or file size; SSIM or JPEG can disagree.

**Is the SVD unique?** The singular values are unique. Singular vectors are unique only up to sign (and up to rotation within a repeated singular value).

**What is the rank of an image?** The number of non-zero singular values (linearly independent columns). Real photographs are full rank numerically but have rapidly decaying singular values.

**How many numbers does rank k store?** k(m + n + 1) per channel: k vectors of length m, k of length n, and k singular values. Compression in numbers happens when k(m+n+1) < mn, i.e. k < mn/(m+n+1).

**Why not compress the colour image as one matrix?** We do R, G and B separately, which is simple but ignores colour correlation (JPEG uses YCbCr for that reason).

**Why can the randomized SVD be faster?** It multiplies A by a random m × (k + p) sketch, applies a few power iterations, orthonormalises (QR) and takes the SVD of a small matrix: O(mnk) instead of the cost of a full SVD. It returns an approximation; we report the energy it actually achieved.

**Is the one-sided Jacobi SVD accurate?** It orthogonalises columns by plane rotations until they are orthogonal to tolerance; the column norms are then σᵢ. It is slower than QR-based methods but very accurate, which is why it suits a teaching project (cost grows like m n² per sweep).

**Why PSNR and SSIM?** PSNR = 10 log₁₀(255²/MSE) measures pixel error; SSIM compares local luminance, contrast and structure. They are measured after the reconstruction is rounded to 8 bits, so they differ slightly from the exact spectral error.

**Does SVD beat JPEG?** Usually not in file size. Our "compression" is a count of numbers; real codecs also quantise and entropy-code.

**What is the adaptive block method?** Cut the image into tiles, store each tile's mean, and spend rank where the tile has the most detail energy. It can beat one global rank on images with flat and detailed regions, at the price of tile-edge artefacts and more bookkeeping.

**What security checks does the website do?** Content-sniffed formats only, 20 MB upload cap, a decoded-pixel limit checked from the header before allocation, bounded PNG decompression (zip-bomb safe), no file names echoed into HTML, strict Content-Security-Policy, nothing leaves the machine.

## 6. Backup procedures

* **Server will not start:** run `svdcomp-web --port 5050`; or `python -m svdcomp.web`.
* **Browser problem:** any Chromium, Firefox or Safari; MathML needs Chrome/Edge 109+.
* **Projector resolution small:** use Presentation mode and `Ctrl +`.
* **No network:** nothing in the application needs it; the Sphinx docs on Read the Docs do (use `docs/_build` locally: `pip install -e ".[docs]"; python -m sphinx -b html docs docs/_build/html`).
* **Browser demo fails completely:** use the command line:

```powershell
svdcomp info photo.png
svdcomp compress photo.png out.png -k 20
svdcomp benchmark photo.png
```

and show the pre-rendered figures in `docs/_static/figures/` and the screenshots in `docs/_static/screenshots/`.
