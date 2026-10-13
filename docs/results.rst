Results
=======

Interactive: explore the rank
-----------------------------

Drag the slider to move through the rank-*k* reconstructions of a
256 × 256 photo. Each image and every number below was produced by
``svdcomp`` itself (``scripts/make_figures.py``).

.. raw:: html

   <div class="svd-slider" data-base="_static/figures/">Loading the interactive slider…</div>

.. note::

   Past :math:`k^\ast = mn/(m+n+1) \approx 127.8` the factors take *more*
   numbers than the pixels, so the ratio drops below 1. Compression only pays
   off for :math:`k < k^\ast`.

The spectrum
------------

.. image:: _static/figures/sigma.svg
   :alt: Singular values of the red, green and blue channels on a log scale

.. image:: _static/figures/error.svg
   :alt: Relative squared error of the best rank-k approximation on a log scale

The singular values fall by two orders of magnitude within the first 20
layers. By Eckart–Young the right-hand curve is exactly the discarded share
of :math:`\sum_i\sigma_i^2`, so it is the best that *any* rank-*k* image can
do.

Global versus adaptive blocks
-----------------------------

.. grid:: 1 1 3 3
   :gutter: 2

   .. grid-item-card:: Global, k = 35

      .. image:: _static/figures/k035.png

      3.65× · 26.65 dB · SSIM 0.774

   .. grid-item-card:: Adaptive 16 × 16, τ = 0.95

      .. image:: _static/figures/blocks.png

      **4.25×** · **27.94 dB** · SSIM **0.839**

   .. grid-item-card:: Rank per tile

      .. image:: _static/figures/blocks_ranks.png

      Darker tiles keep more layers (0–6, mean 1.8).

On this detailed photo, adaptive blocks give **more compression and better
quality at the same time**. Rank concentrates in the detailed tiles, while
flat background tiles get almost none. On very smooth images, such as
gradient wallpapers, global truncation can win instead. See the table below.

Rank versus quality (512 × 512 grayscale photo)
-----------------------------------------------

.. list-table::
   :header-rows: 1

   * - k
     - Stored numbers
     - Ratio
     - Energy kept
     - PSNR (dB)
     - SSIM
   * - 5
     - 5,125
     - 51.2×
     - 99.634 %
     - 27.79
     - 0.915
   * - 10
     - 10,250
     - 25.6×
     - 99.904 %
     - 33.57
     - 0.952
   * - 20
     - 20,500
     - 12.8×
     - 99.978 %
     - 40.00
     - 0.979
   * - 50
     - 51,250
     - 5.1×
     - 99.997 %
     - 48.90
     - 0.995
   * - 100
     - 102,500
     - 2.6×
     - ≈100 %
     - 56.30
     - 0.998

.. dropdown:: Adaptive blocks on the same smooth image
   :icon: table

   .. list-table::
      :header-rows: 1

      * - Detail energy τ
        - Stored numbers
        - Ratio
        - PSNR (dB)
        - SSIM
        - Mean tile rank
      * - 0.90
        - 17,623
        - 14.9×
        - 36.03
        - 0.933
        - 0.49
      * - 0.95
        - 25,906
        - 10.1×
        - 39.03
        - 0.962
        - 0.74
      * - 0.99
        - 46,267
        - 5.7×
        - 45.87
        - 0.990
        - 1.34

   On this smooth gradient, global truncation is slightly better per stored
   number (12.8× at 40.0 dB versus 14.9× at 36.0 dB).

Runtime
-------

Measured on an Apple M4 with Python 3.14 and NumPy 2.5, on grayscale input.

.. list-table::
   :header-rows: 1

   * - Size
     - Exact Jacobi SVD
     - Randomized SVD (k = 50)
   * - 128 × 128
     - 0.21 s
     - 0.06 s
   * - 256 × 256
     - 1.23 s
     - 0.04 s
   * - 512 × 512
     - 11.0 s
     - 0.06 s

The exact SVD grows as :math:`O(n^3)` and the randomized one as
:math:`O(mnk)`. That is why the web UI defaults to the randomized method.

.. seealso::

   :doc:`mathematics` for the theory behind these numbers, and
   ``svdcomp benchmark`` to reproduce them on your own images.

Image credit: astronaut Eileen Collins, NASA (public domain).
