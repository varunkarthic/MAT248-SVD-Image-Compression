svdcomp
=======

**Image compression with a from-scratch Singular Value Decomposition.**

.. figure:: _static/figures/hero.png
   :class: hero-figure
   :alt: Rank 5, 20 and 50 reconstructions next to the original image

   Rank-5, rank-20 and rank-50 reconstructions next to the 256 × 256 original.
   The rank-50 image keeps 99.6 % of the energy at 2.6× fewer numbers.

``svdcomp`` stores every colour channel as a short list of rank-1 *layers*
and keeps only the most important ones:

.. math::

   A = \sum_{i=1}^{r} \sigma_i\, u_i v_i^{T}
   \quad\longrightarrow\quad
   A_k = \sum_{i=1}^{k} \sigma_i\, u_i v_i^{T},
   \qquad k(m+n+1) \ll mn .

Everything mathematical is written from scratch for **MAT248**: Householder
QR, a batched one-sided Jacobi SVD, the randomized SVD, PSNR/SSIM, and the
PNG, BMP and PNM codecs. NumPy provides only array arithmetic.

.. grid:: 1 2 2 3
   :gutter: 3

   .. grid-item-card:: :octicon:`rocket;1.2em` Get started
      :link: usage
      :link-type: doc

      Install, then compress from the command line, from Python or in the
      Flask web UI.

   .. grid-item-card:: :octicon:`mortar-board;1.2em` Mathematics
      :link: mathematics
      :link-type: doc

      SVD via the spectral theorem, Eckart–Young proofs, Jacobi rotations,
      randomized SVD bounds, PSNR and SSIM.

   .. grid-item-card:: :octicon:`graph;1.2em` Results
      :link: results
      :link-type: doc

      Try the interactive rank slider and see the measured quality, size and
      runtime.

   .. grid-item-card:: :octicon:`stack;1.2em` Architecture
      :link: architecture
      :link-type: doc

      Layers, data flow and the design decisions behind them.

   .. grid-item-card:: :octicon:`code;1.2em` API reference
      :link: api
      :link-type: doc

      Every public function, generated from the docstrings.

   .. grid-item-card:: :octicon:`mark-github;1.2em` Source code
      :link: https://github.com/varunkarthic/MAT248-SVD-Image-Compression

      Issues, milestones, CI and the full history on GitHub.

At a glance
-----------

.. list-table::
   :widths: 30 70

   * - **SVD algorithms**
     - Exact one-sided Jacobi (QR-preconditioned, batched) · randomized SVD with power iterations
   * - **Compression modes**
     - Fixed rank *k* · energy target · adaptive block-wise ranks
   * - **Metrics**
     - Compression ratio · PSNR · SSIM · relative Frobenius error · retained energy
   * - **Formats**
     - PNG (1–16 bit, all colour types) · BMP · PGM/PPM, all decoded by our own code
   * - **Interfaces**
     - ``svdcomp`` CLI · Python API · ``svdcomp-web`` Flask UI

.. toctree::
   :hidden:
   :caption: Guide

   usage
   results

.. toctree::
   :hidden:
   :caption: Theory & design

   mathematics
   architecture

.. toctree::
   :hidden:
   :caption: Reference

   api
