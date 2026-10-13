System Architecture & Design
============================

This chapter describes how ``svdcomp`` is put together: the layers, what each
module owns, how data moves through the system, and the constraints that shaped
the design.

Design goals
------------

1. **All mathematics is ours.** The SVD, the QR factorisation, the quality
   metrics and every image codec are implemented in this repository. NumPy is
   used only as an n-dimensional array with vectorised arithmetic. Package code
   never calls NumPy's ``linalg`` module, PIL/Pillow, SciPy, OpenCV or
   scikit-image. A test (``tests/test_purity.py``) enforces this.
2. **Correct before fast.** The exact SVD is a one-sided Jacobi method. It is
   slower than LAPACK, but it is backward stable and computes small singular
   values to high relative accuracy. The randomized SVD is the fast path.
3. **One engine, three front ends.** The Python API, the CLI and the Flask web
   UI all call the same functions. No front end contains any math.
4. **Measured, not claimed.** Every compression reports its storage cost,
   compression ratio, PSNR, SSIM and Frobenius error.

Layered view
------------

.. code-block:: text

   ┌──────────────────────────────────────────────────────────────────────┐
   │  Front ends                                                          │
   │   cli.py  (argparse)        web.py + templates/index.html (Flask)    │
   └───────────────┬───────────────────────────────┬──────────────────────┘
                   │                               │
   ┌───────────────▼───────────────────────────────▼──────────────────────┐
   │  Application layer                                                   │
   │   compress.py   decompose · reconstruct · compress · compress_blocks │
   │                 rank_for_energy · storage_cost                       │
   │   metrics.py    mse · psnr · ssim · relative_error                   │
   └───────────────┬───────────────────────────────┬──────────────────────┘
                   │                               │
   ┌───────────────▼──────────────┐   ┌────────────▼─────────────────────┐
   │  Numerical core  linalg.py   │   │  Codecs  formats.py              │
   │   householder_qr             │   │   PNG  (chunks, CRC, filters)    │
   │   jacobi_svd (batched)       │   │   BMP  (8/24/32-bit)             │
   │   randomized_svd             │   │   PNM  (P2/P3/P5/P6)             │
   └───────────────┬──────────────┘   └────────────┬─────────────────────┘
                   │                               │
   ┌───────────────▼───────────────────────────────▼──────────────────────┐
   │  Platform: NumPy arrays (ndarray arithmetic only) · stdlib zlib      │
   └──────────────────────────────────────────────────────────────────────┘

Each layer imports only from the layers below it. ``linalg`` and ``formats``
do not know about each other, so the numerical core can be tested on plain
matrices and the codecs can be tested on plain bytes.

Module responsibilities
-----------------------

``svdcomp.linalg``
   Dense linear algebra on ``float64`` arrays.

   * ``householder_qr(A)``: thin QR by Householder reflections.
   * ``jacobi_svd(A)``: exact SVD by one-sided (Hestenes) Jacobi rotations.
     It accepts a stack ``(..., m, n)``, so the three colour channels, or
     hundreds of image tiles, are decomposed in one vectorised pass. Each
     sweep visits the column pairs in *round-robin tournament* order. The
     ``n/2`` pairs in a round are disjoint, so a whole round is a single NumPy
     operation.
   * ``randomized_svd(A, k)``: the Halko–Martinsson–Tropp randomized range
     finder with power iterations, followed by ``jacobi_svd`` of a small
     ``(k+p) × n`` matrix.

``svdcomp.formats``
   Bytes ⇄ ``uint8`` arrays of shape ``(H, W)`` or ``(H, W, C)``.
   ``read_image`` identifies the format from its magic bytes. ``write_image``
   chooses the format from the file extension. DEFLATE uses the standard
   library's ``zlib``. Chunk parsing, CRC checks, scanline filters (including
   Paeth), palette expansion and bit unpacking are all implemented here.

``svdcomp.compress``
   Turns images into factor sets and back. Channels are handled as a batch:
   ``decompose`` returns ``Factors(U, s, Vt)`` with a leading channel axis.
   ``reconstruct(factors, k)`` forms
   :math:`A_k = U_{:, :k}\,\mathrm{diag}(\sigma_{:k})\,V^T_{:k,:}` and
   clips the result to ``[0, 255]``. ``compress_blocks`` implements adaptive
   tile-wise ranks.

``svdcomp.metrics``
   MSE, PSNR, SSIM (Gaussian window, implemented with a separable convolution
   built from array slicing), relative Frobenius error and retained energy.

``svdcomp.cli``
   The ``svdcomp`` command with three subcommands: ``compress``, ``info`` and
   ``benchmark`` (CSV output).

``svdcomp.web``
   Flask application factory ``create_app()``. It exposes JSON endpoints and a
   single-page UI.

Data flow
---------

Compressing an upload in the web UI:

.. code-block:: text

   browser ──file──► POST /api/decompose
                       │ formats.read_image(bytes)     → uint8 (H,W,C)
                       │ validate size / channels
                       │ compress.decompose(img, method)
                       │      └─ linalg.jacobi_svd  (batched over C)
                       │         or linalg.randomized_svd per channel
                       │ cache[token] = (img, factors)  (bounded LRU)
                       ◄── {token, shape, singular values, max rank}

   slider ──k──────► GET /api/reconstruct?token&k
                       │ compress.reconstruct(factors, k)   O(k·m·n)
                       │ metrics.psnr / ssim / relative_error
                       │ formats.encode_png
                       ◄── {png (base64), k, ratio, psnr, ssim, ...}

The expensive step, the SVD, runs **once** per upload. Moving the slider only
re-multiplies the cached factors, which costs :math:`O(kmn)` and takes
milliseconds. This split is the main performance decision in the web
architecture.

Key design decisions
--------------------

.. list-table::
   :header-rows: 1
   :widths: 28 72

   * - Decision
     - Rationale
   * - One-sided Jacobi for the exact SVD
     - It works on :math:`A` directly and never forms :math:`A^TA`, which
       would square the condition number. It is simple to prove correct and
       vectorises well with round-robin pair ordering.
   * - Batched leading axis
     - Colour channels and image tiles are independent matrices of the same
       shape. Stacking them turns many Python-level loops into one.
   * - Randomized SVD as the fast path
     - The cost is :math:`O(mnk)` instead of :math:`O(mn\min(m,n))`, with a
       provable error bound (see :doc:`mathematics`).
   * - Per-channel RGB compression
     - The simplest correct model. Each channel is a matrix and the storage
       is summed. The alpha channel is compressed like any other channel.
   * - Browser-side conversion for JPEG/WebP uploads
     - The server decodes PNG, BMP and PNM itself. Other formats are
       re-encoded to PNG by the browser's ``<canvas>`` before upload, so the
       server never needs a JPEG decoder.
   * - In-process LRU cache of factors
     - The UI needs fast slider feedback, and a single-process deployment is
       the target. A shared store such as Redis is only needed for multi-worker
       deployments.

Complexity budget
-----------------

For an :math:`m \times n` channel with :math:`m \ge n`:

.. list-table::
   :header-rows: 1

   * - Operation
     - Cost
   * - One Jacobi sweep
     - :math:`O(mn^2)`, usually 6–12 sweeps
   * - Randomized SVD, rank :math:`k`, :math:`q` power iterations
     - :math:`O((2q+2)\,mn\,(k+p))`
   * - Reconstruction of :math:`A_k`
     - :math:`O(kmn)`
   * - Storage of :math:`A_k`
     - :math:`k(m+n+1)` numbers

Error handling
--------------

* The codecs raise ``ValueError`` with a specific message for unsupported or
  corrupt input, such as a bad CRC, an interlaced PNG or an unknown magic
  number.
* The web layer turns ``ValueError`` into HTTP 400 responses with a JSON error
  body, enforces a maximum upload size (``MAX_CONTENT_LENGTH``) and a maximum
  pixel count, and returns 404 for expired cache tokens.

Testing strategy
----------------

* **linalg**: orthogonality and reconstruction residuals, agreement with
  closed-form singular values, rank-deficient and wide inputs, the
  Eckart–Young identity.
* **formats**: encode → decode round trips for every colour type and bit
  depth, hand-made fixtures, corruption detection.
* **compress / metrics**: storage accounting, energy-based rank, known PSNR
  values, SSIM = 1 for identical images.
* **web**: Flask test client against every endpoint, including error paths.
* **purity**: a static check that package code uses no pre-built math or
  imaging libraries.
