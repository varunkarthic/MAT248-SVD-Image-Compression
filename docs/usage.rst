Getting Started
===============

Installation
------------

Python 3.10 or newer is required.

.. code-block:: console

   $ git clone https://github.com/varunkarthic/MAT248-SVD-Image-Compression.git
   $ cd MAT248-SVD-Image-Compression
   $ python -m venv .venv && source .venv/bin/activate
   $ pip install -e ".[dev]"
   $ pytest

.. tip::

   ``pip install -e ".[docs]"`` installs everything needed to build this
   documentation locally with ``sphinx-build -b html docs docs/_build/html``.

Three ways to compress
----------------------

.. tab-set::

   .. tab-item:: :octicon:`terminal` Command line

      Compress with a fixed rank, an energy target, or adaptive blocks:

      .. code-block:: console

         $ svdcomp compress photo.png out.png -k 50
         $ svdcomp compress photo.png out.png -k 50 --method randomized
         $ svdcomp compress photo.png out.png --energy 0.999
         $ svdcomp compress photo.png out.png --blocks 16 --energy 0.95

      Example output:

      .. code-block:: text

         rank k        : 40
         stored values : 153,720 / 1,228,800 (ratio 7.99x)
         energy kept   : 99.988 %
         PSNR          : 41.78 dB
         SSIM          : 0.9840
         rel. error    : 0.0112
         time          : 0.26 s

      Inspect the spectrum, or benchmark many ranks after a single
      decomposition:

      .. code-block:: console

         $ svdcomp info photo.png --sigma-csv sigma.csv
         $ svdcomp benchmark photo.png --ks 5,10,20,50,100 --csv bench.csv

   .. tab-item:: :octicon:`code` Python

      .. code-block:: python

         from svdcomp.formats import read_image, write_image
         from svdcomp.compress import compress, compress_blocks, decompose, result_for_rank

         img = read_image("photo.png")                 # uint8 (H, W) or (H, W, C)

         result = compress(img, k=50)                  # exact Jacobi SVD
         print(result.ratio, result.metrics["psnr"], result.metrics["ssim"])
         write_image("photo_k50.png", result.image)

         factors = decompose(img, method="randomized", rank=100)   # decompose once...
         for k in (10, 25, 50, 100):                                 # ...evaluate many ranks
             print(k, result_for_rank(img, factors, k).metrics["psnr"])

         blocks = compress_blocks(img, block=16, energy=0.95)
         print(blocks.k)                               # rank map, one entry per tile

      The linear-algebra routines work on any matrix, or on a stack of them:

      .. code-block:: python

         import numpy as np
         from svdcomp.linalg import jacobi_svd

         A = np.random.default_rng(0).standard_normal((300, 200))
         U, s, Vt = jacobi_svd(A)
         assert np.allclose((U * s) @ Vt, A)

   .. tab-item:: :octicon:`browser` Web UI

      .. code-block:: console

         $ svdcomp-web                          # http://127.0.0.1:5000
         $ svdcomp-web --host 0.0.0.0 --port 8000

      1. **Upload** an image (drag and drop works).
      2. **Global rank k**: choose *Randomized* (fast) or *Exact Jacobi*
         (full spectrum, up to 512 × 512) and press *Compute SVD*. The slider
         then re-renders :math:`A_k` instantly from cached factors.
      3. **Adaptive blocks**: choose a tile size and a detail-energy target.
      4. Compare the images side by side, read the metrics and charts, and
         download the result as PNG.

Command reference
-----------------

.. list-table::
   :header-rows: 1
   :widths: 22 38 40

   * - Command
     - Options
     - Output
   * - ``svdcomp compress IN OUT``
     - ``-k K`` | ``--energy E`` | ``--blocks SIZE [--energy E]``
     - Compressed image plus a summary of ratio, PSNR, SSIM and error
   * - ``svdcomp info IN``
     - ``--rank R``, ``--sigma-csv FILE``
     - Spectrum summary and the *k* needed for 90–99.9 % energy
   * - ``svdcomp benchmark IN``
     - ``--ks 1,5,10``, ``--csv FILE``
     - CSV of k, size, ratio, energy, PSNR, SSIM and error

Every command also accepts ``--method exact|randomized`` and ``--seed N``.

Supported formats
-----------------

.. list-table::
   :header-rows: 1
   :widths: 14 50 36

   * - Format
     - Read
     - Write
   * - PNG
     - Gray, gray+alpha, RGB, RGBA, palette + tRNS; 1–16 bit; non-interlaced
     - 8-bit gray / GA / RGB / RGBA
   * - BMP
     - 1/4/8-bit palette, 24-bit, 32-bit (``BI_RGB``, ``BI_BITFIELDS``)
     - 8-bit gray, 24-bit RGB
   * - PGM / PPM
     - ``P2``, ``P3``, ``P5``, ``P6``; maxval up to 65535
     - ``P5``, ``P6``

.. note::

   The web UI also accepts JPEG, WebP and GIF. The browser converts them to
   PNG before upload, so the server never needs a JPEG decoder.

Web JSON API
------------

.. dropdown:: Endpoints, parameters and responses
   :icon: plug

   .. list-table::
      :header-rows: 1

      * - Endpoint
        - Parameters
        - Returns
      * - ``POST /api/upload``
        - multipart ``image``
        - ``token``, ``width``, ``height``, ``channels``, ``original`` (PNG data URL), limits
      * - ``POST /api/decompose``
        - ``token``, ``method``, ``rank``
        - ``max_rank``, ``sigma`` per channel, cumulative ``energy``, ``suggested_k``
      * - ``GET /api/reconstruct``
        - ``token``, ``k``
        - ``image``, ``k``, ``stored_values``, ``ratio``, ``metrics``
      * - ``POST /api/blocks``
        - ``token``, ``block``, ``energy``
        - ``image``, ``ranks`` (tile grid), ``ratio``, ``metrics``

   Errors are returned as ``{"error": "..."}``: 400 for invalid input, 404 for
   an unknown or expired token, 413 for uploads over 20 MB. An infinite PSNR
   (a lossless result) is returned as ``null``.

.. warning::

   Decomposed images are cached in process memory (an LRU of 8 entries).
   Serve the app with a **single worker process**. Threads are fine.
