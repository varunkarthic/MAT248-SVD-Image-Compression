Installation & Usage
====================

Installation
------------

Python 3.10 or newer is required.

.. code-block:: bash

   git clone https://github.com/varunkarthic/MAT248-SVD-Image-Compression.git
   cd MAT248-SVD-Image-Compression
   python -m venv .venv && source .venv/bin/activate
   pip install -e ".[dev]"      # numpy, flask, pytest
   pytest                       # run the test suite

Supported formats
-----------------

.. list-table::
   :header-rows: 1

   * - Format
     - Read
     - Write
   * - PNG
     - all colour types (gray, gray+alpha, RGB, RGBA, palette + tRNS), bit depths 1–16, non-interlaced
     - 8-bit gray / gray+alpha / RGB / RGBA
   * - BMP
     - 1/4/8-bit palette, 24-bit, 32-bit (``BI_RGB``, ``BI_BITFIELDS``)
     - 8-bit gray, 24-bit RGB
   * - PGM / PPM
     - ``P2``, ``P3``, ``P5``, ``P6``, maxval up to 65535
     - ``P5``, ``P6``

The web UI also accepts JPEG, WebP and GIF. The browser re-encodes them to
PNG before upload.

Command line
------------

Compress with a fixed rank, an energy target, or adaptive blocks:

.. code-block:: bash

   svdcomp compress photo.png out.png -k 50
   svdcomp compress photo.png out.png --energy 0.999
   svdcomp compress photo.png out.png -k 50 --method randomized   # fast
   svdcomp compress photo.png out.png --blocks 16 --energy 0.95   # adaptive tiles

Example output::

   rank k        : 40
   stored values : 153,720 / 1,228,800 (ratio 7.99x)
   energy kept   : 99.988 %
   PSNR          : 41.78 dB
   SSIM          : 0.9840
   rel. error    : 0.0112
   time          : 0.26 s

Inspect the spectrum and the ranks needed for given energy levels:

.. code-block:: bash

   svdcomp info photo.png --sigma-csv sigma.csv

Benchmark several ranks after a single decomposition and write a CSV:

.. code-block:: bash

   svdcomp benchmark photo.png --ks 5,10,20,50,100 --csv bench.csv

All subcommands accept ``--method exact|randomized`` and ``--seed``.

Python API
----------

.. code-block:: python

   from svdcomp.formats import read_image, write_image
   from svdcomp.compress import compress, compress_blocks, decompose, result_for_rank

   img = read_image("photo.png")                 # uint8 (H, W) or (H, W, C)

   result = compress(img, k=50)                  # exact Jacobi SVD
   print(result.ratio, result.metrics["psnr"], result.metrics["ssim"])
   write_image("photo_k50.png", result.image)

   # Decompose once, evaluate many ranks
   factors = decompose(img, method="randomized", rank=100)
   for k in (10, 25, 50, 100):
       r = result_for_rank(img, factors, k)
       print(k, r.stored_values, round(r.metrics["psnr"], 2))

   # Adaptive tiles
   blocks = compress_blocks(img, block=16, energy=0.95)
   print(blocks.k)                               # rank map, one entry per tile

The linear-algebra routines work on any matrix:

.. code-block:: python

   import numpy as np
   from svdcomp.linalg import jacobi_svd, randomized_svd, householder_qr

   A = np.random.default_rng(0).standard_normal((300, 200))
   U, s, Vt = jacobi_svd(A)                      # also accepts stacks (..., m, n)
   assert np.allclose((U * s) @ Vt, A)

Web UI
------

.. code-block:: bash

   svdcomp-web                 # http://127.0.0.1:5000
   svdcomp-web --host 0.0.0.0 --port 8000

1. **Upload** an image (drag and drop works).
2. **Global rank k**: choose *Randomized* (fast, leading triplets up to a rank
   budget) or *Exact Jacobi* (full spectrum, images up to 512 × 512), then
   press *Compute SVD*. Dragging the slider re-renders :math:`A_k` instantly
   from cached factors.
3. **Adaptive blocks**: choose a tile size and a detail-energy target.
4. Review the original and compressed images side by side, the metrics (ratio,
   PSNR, SSIM, energy, relative error), the singular-value decay and the
   Eckart–Young error curve, or a heat map of the rank per tile. Download the
   result as PNG.

JSON API
~~~~~~~~

.. list-table::
   :header-rows: 1

   * - Endpoint
     - Parameters
     - Returns
   * - ``POST /api/upload``
     - multipart ``image``
     - ``token``, ``width``, ``height``, ``channels``, ``original`` (PNG data URL), limits
   * - ``POST /api/decompose``
     - ``token``, ``method`` (``randomized``/``exact``), ``rank``
     - ``max_rank``, ``sigma`` (per channel), ``energy`` (cumulative), ``suggested_k``
   * - ``GET /api/reconstruct``
     - ``token``, ``k``
     - ``image`` (PNG data URL), ``k``, ``stored_values``, ``ratio``, ``metrics``
   * - ``POST /api/blocks``
     - ``token``, ``block``, ``energy``
     - ``image``, ``ranks`` (tile grid), ``ratio``, ``metrics``

Errors are returned as ``{"error": "..."}``: 400 for invalid input, 404 for an
unknown or expired token, 413 for uploads over 20 MB. Infinite PSNR (a
lossless result) is serialised as ``null``.

.. note::

   Decomposed images are cached in process memory (an LRU of 8 entries), so run
   the app with a single worker process. Threads are fine.
