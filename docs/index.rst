svdcomp: SVD Image Compression
==============================

``svdcomp`` compresses images by keeping only the most important *layers* of
each colour channel's Singular Value Decomposition:

.. math::

   A = \sum_{i=1}^{r} \sigma_i\, u_i v_i^{T}
   \qquad\longrightarrow\qquad
   A_k = \sum_{i=1}^{k} \sigma_i\, u_i v_i^{T}.

Keeping :math:`k` layers costs :math:`k(m+n+1)` numbers instead of
:math:`mn`, and by the Eckart–Young theorem :math:`A_k` is the best rank-k
approximation there is.

The project was built for **MAT248**. Everything mathematical is written from
scratch: Householder QR, a batched one-sided Jacobi SVD, the randomized SVD,
PSNR/SSIM, and the PNG, BMP and PNM codecs. NumPy provides only the array
arithmetic, and Flask serves the web UI.

.. toctree::
   :maxdepth: 2
   :caption: Contents

   usage
   mathematics
   architecture
   results
   api
