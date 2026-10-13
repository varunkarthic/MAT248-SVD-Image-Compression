Results
=======

These measurements were taken on an Apple M4 laptop with Python 3.14 and
NumPy 2.5. The test image is a 640 × 640 photo-like gradient wallpaper, used
in grayscale and cropped to 512 × 512 where noted. Reproduce them with
``svdcomp benchmark``.

Rank versus quality (512 × 512 grayscale, exact SVD)
----------------------------------------------------

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

As predicted in :doc:`mathematics`, :math:`\sigma_1` alone carries most of the
energy, and quality keeps improving long after "energy kept" rounds to
100 %.

Adaptive blocks (16 × 16 tiles, same image)
-------------------------------------------

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

On this smooth image, global truncation is slightly better per stored number
(12.8× at 40.0 dB versus 14.9× at 36.0 dB). Smooth gradients are close to low
rank globally, while tiles pay a per-tile mean and cut the gradient into
pieces. Block mode does better on images that mix flat regions with localised
detail, which is the case PatchSVD targets.

Runtime
-------

.. list-table::
   :header-rows: 1

   * - Grayscale size
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
:math:`O(mnk)`. This is why the web UI defaults to the randomized method and
only offers the exact one for images up to 512 × 512.
