Mathematics
===========

.. grid:: 1 1 3 3
   :gutter: 2

   .. grid-item-card:: Decompose
      :text-align: center

      :math:`A = U\Sigma V^T = \sum_i \sigma_i u_i v_i^T`

   .. grid-item-card:: Truncate
      :text-align: center

      :math:`A_k = \sum_{i\le k} \sigma_i u_i v_i^T`, stored in :math:`k(m+n+1)` numbers

   .. grid-item-card:: Guarantee
      :text-align: center

      :math:`\lVert A-A_k\rVert_F^2 = \sum_{i>k}\sigma_i^2` is optimal

This chapter develops the mathematics behind ``svdcomp``, from the definition of
the Singular Value Decomposition to the algorithms that compute it and the
metrics that judge the result. Every formula here is implemented in the
package, and the text names the function that implements it.

Images as matrices
------------------

A grayscale image of height :math:`m` and width :math:`n` is a matrix

.. math::

   A \in \mathbb{R}^{m \times n}, \qquad a_{ij} \in \{0, 1, \dots, 255\},

where :math:`a_{ij}` is the brightness of the pixel in row :math:`i` and column
:math:`j`. A colour image is three such matrices :math:`A^{(R)}, A^{(G)},
A^{(B)}`, plus :math:`A^{(\alpha)}` when it has an alpha channel. ``svdcomp``
compresses each channel independently and decomposes all channels in one
batched computation (``compress.decompose``).

Neighbouring pixels in natural images are strongly correlated, so their rows
and columns are far from independent. Linear algebra describes this as the
matrix being *close to low rank*, and the SVD measures exactly how close.


The Singular Value Decomposition
--------------------------------

.. admonition:: Theorem (SVD)
   :class: tip

   Every real matrix :math:`A \in \mathbb{R}^{m \times n}` with
   :math:`r = \operatorname{rank}(A)` can be factored as

   .. math::

      A = U \Sigma V^{T},

   where

   * :math:`U = [u_1 \mid \dots \mid u_m] \in \mathbb{R}^{m \times m}` is
     orthogonal (:math:`U^TU = I_m`). Its columns are the *left singular vectors*.
   * :math:`V = [v_1 \mid \dots \mid v_n] \in \mathbb{R}^{n \times n}` is
     orthogonal (:math:`V^TV = I_n`). Its columns are the *right singular
     vectors*.
   * :math:`\Sigma \in \mathbb{R}^{m \times n}` is zero except on its diagonal,
     :math:`\Sigma_{ii} = \sigma_i`, with

     .. math::

        \sigma_1 \ge \sigma_2 \ge \dots \ge \sigma_r > 0 = \sigma_{r+1} = \dots = \sigma_{\min(m,n)}.

   The :math:`\sigma_i` are the *singular values*.

.. dropdown:: Proof via the spectral theorem
   :icon: light-bulb


   The matrix :math:`A^TA \in \mathbb{R}^{n\times n}` is symmetric, and it is
   positive semi-definite because

   .. math::

      x^T A^T A x = \lVert A x \rVert_2^2 \ge 0 \quad \text{for all } x.

   By the **spectral theorem** it has an orthonormal eigenbasis
   :math:`v_1, \dots, v_n` with real eigenvalues
   :math:`\lambda_1 \ge \dots \ge \lambda_n \ge 0`:

   .. math::

      A^TA = V \Lambda V^T, \qquad \Lambda = \operatorname{diag}(\lambda_1, \dots, \lambda_n).

   Define :math:`\sigma_i = \sqrt{\lambda_i}`. Exactly :math:`r` of them are
   positive, because :math:`\operatorname{rank}(A^TA) = \operatorname{rank}(A)`.
   For :math:`i \le r` set

   .. math::

      u_i = \frac{A v_i}{\sigma_i}.

   These vectors are orthonormal:

   .. math::

      u_i^T u_j = \frac{v_i^T A^T A v_j}{\sigma_i \sigma_j}
                = \frac{\lambda_j\, v_i^T v_j}{\sigma_i \sigma_j}
                = \delta_{ij}.

   Extend :math:`u_1, \dots, u_r` to an orthonormal basis of
   :math:`\mathbb{R}^m` (Gram–Schmidt). Then :math:`A v_i = \sigma_i u_i` for
   every :math:`i`, since :math:`A v_i = 0` when :math:`\sigma_i = 0`. In matrix
   form this is :math:`AV = U\Sigma`, and multiplying on the right by :math:`V^T`
   gives :math:`A = U\Sigma V^T`. :math:`\blacksquare`

   The same argument applied to :math:`AA^T` shows that the :math:`u_i` are its
   eigenvectors. So the left singular vectors span the column space of
   :math:`A` and the right singular vectors span its row space.

Geometric meaning
~~~~~~~~~~~~~~~~~

Read from right to left, :math:`A = U\Sigma V^T` says that every linear map is
a **rotation or reflection** (:math:`V^T`), followed by an **axis-aligned
stretch** (:math:`\Sigma`), followed by another **rotation or reflection**
(:math:`U`). The unit sphere is mapped to an ellipsoid with semi-axes
:math:`\sigma_i u_i`.

The outer-product (layer) form
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Multiplying out the block structure gives the expansion that drives
compression:

.. math::

   A = \sum_{i=1}^{r} \sigma_i\, u_i v_i^{T}.

Each term :math:`\sigma_i u_i v_i^T` is a **rank-1 layer**: one column
pattern times one row pattern, scaled by its weight :math:`\sigma_i`.
Truncating the sum after :math:`k` terms gives the rank-:math:`k`
approximation

.. math::

   A_k = \sum_{i=1}^{k} \sigma_i\, u_i v_i^{T} = U_k \Sigma_k V_k^T,

where :math:`U_k \in \mathbb{R}^{m\times k}`, :math:`\Sigma_k \in
\mathbb{R}^{k\times k}` and :math:`V_k \in \mathbb{R}^{n\times k}` are the
leading blocks (``compress.reconstruct``).

Thin SVD
~~~~~~~~

Only the first :math:`p = \min(m, n)` columns of :math:`U` and :math:`V` ever
meet a nonzero entry of :math:`\Sigma`. The package therefore returns the
*thin* SVD :math:`U \in \mathbb{R}^{m\times p}`, :math:`\sigma \in
\mathbb{R}^{p}`, :math:`V^T \in \mathbb{R}^{p \times n}`.


Matrix norms and singular values
--------------------------------

Two norms measure approximation error.

**Frobenius norm.** This is the Euclidean length of the matrix viewed as a
vector of :math:`mn` pixels:

.. math::

   \lVert A \rVert_F = \Big(\sum_{i,j} a_{ij}^2\Big)^{1/2}
                   = \sqrt{\operatorname{tr}(A^TA)}
                   = \Big(\sum_{i=1}^{r} \sigma_i^2\Big)^{1/2}.

The last equality holds because the Frobenius norm is invariant under
orthogonal transformations. It gives
:math:`\lVert U\Sigma V^T \rVert_F = \lVert \Sigma \rVert_F`.

**Spectral (operator 2-) norm.**

.. math::

   \lVert A \rVert_2 = \max_{\lVert x \rVert_2 = 1} \lVert A x\rVert_2 = \sigma_1.

The quantity :math:`\sigma_i^2` is the **energy** carried by layer
:math:`i`. The total energy of the image is
:math:`\lVert A\rVert_F^2 = \sum_i \sigma_i^2`.


Optimality: the Eckart–Young–Mirsky theorem
-------------------------------------------

.. admonition:: Theorem (Eckart–Young–Mirsky)
   :class: tip

   For every :math:`k < r` and every matrix :math:`B` with
   :math:`\operatorname{rank}(B) \le k`,

   .. math::

      \lVert A - A_k \rVert_2 = \sigma_{k+1} \le \lVert A - B \rVert_2,
      \qquad
      \lVert A - A_k \rVert_F = \Big(\sum_{i=k+1}^{r} \sigma_i^2\Big)^{1/2} \le \lVert A - B \rVert_F .

   In words, **truncated SVD is the best possible rank-k approximation**, and the
   error is exactly the singular values that were thrown away.

.. dropdown:: Proof for the spectral norm
   :icon: light-bulb


   First, :math:`A - A_k = \sum_{i>k}\sigma_i u_i v_i^T` has largest singular
   value :math:`\sigma_{k+1}`. Now let :math:`\operatorname{rank}(B)\le k`. Its
   null space has dimension at least :math:`n-k`, and
   :math:`\operatorname{span}\{v_1,\dots,v_{k+1}\}` has dimension :math:`k+1`.
   Since :math:`(n-k)+(k+1) > n`, the two subspaces share a unit vector
   :math:`w = \sum_{i\le k+1} c_i v_i` with :math:`\sum c_i^2 = 1`. Then

   .. math::

      \lVert A - B\rVert_2^2 \ge \lVert (A-B)w \rVert_2^2 = \lVert A w\rVert_2^2
      = \sum_{i=1}^{k+1} \sigma_i^2 c_i^2 \ge \sigma_{k+1}^2. \qquad\blacksquare

.. dropdown:: Proof for the Frobenius norm
   :icon: light-bulb


   Weyl's inequality for singular values states
   :math:`\sigma_{i+j-1}(X+Y) \le \sigma_i(X) + \sigma_j(Y)`. Take
   :math:`X = A-B`, :math:`Y = B` and :math:`j = k+1`. Since
   :math:`\sigma_{k+1}(B) = 0`,

   .. math::

      \sigma_{i+k}(A) \le \sigma_i(A - B) \quad\Longrightarrow\quad
      \lVert A - B\rVert_F^2 = \sum_{i\ge 1}\sigma_i(A-B)^2 \ge \sum_{i\ge 1} \sigma_{i+k}(A)^2
      = \lVert A - A_k\rVert_F^2. \qquad\blacksquare

Consequences used in the code
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The **relative squared error** of the best rank-:math:`k` image is the share of
energy discarded:

.. math::

   \frac{\lVert A - A_k\rVert_F^2}{\lVert A\rVert_F^2}
   = \frac{\sum_{i>k}\sigma_i^2}{\sum_{i}\sigma_i^2}
   = 1 - E(k),
   \qquad
   E(k) = \frac{\sum_{i\le k}\sigma_i^2}{\sum_i \sigma_i^2}.

The web UI plots this curve, and the test suite checks the identity
numerically (``test_eckart_young_identity``). A singular value curve that
drops quickly means a small :math:`k` already captures most of the image.


Storage cost and compression ratio
----------------------------------

Keeping :math:`k` layers requires :math:`u_1..u_k` (:math:`km` numbers),
:math:`v_1..v_k` (:math:`kn` numbers) and :math:`\sigma_1..\sigma_k`
(:math:`k` numbers):

.. math::

   S(k) = k\,(m + n + 1) \quad\text{per channel}, \qquad
   \rho(k) = \frac{mn}{k(m+n+1)} \quad\text{(compression ratio)}.

Compression only pays off when :math:`S(k) < mn`, that is, when

.. math::

   k < k^{\ast} = \frac{mn}{m+n+1}.

For a :math:`512\times 512` image, :math:`k^\ast \approx 255.5`. At
:math:`k = 50`, :math:`S = 51{,}250` numbers instead of
:math:`262{,}144`, which is about 19.6 % of the original
(``compress.storage_cost``).

.. note::

   :math:`S(k)` counts *numbers*, not bytes. Pixels are 8-bit integers. If
   :math:`u_i, v_i` are stored as 32-bit floats, the byte ratio is four times
   smaller than :math:`\rho(k)`. Quantising the factors (for example to 8 or
   16 bits) narrows that gap, at the cost of extra error. This is one reason
   plain SVD loses to JPEG in the literature.


Choosing the rank
-----------------

Besides a fixed :math:`k`, ``svdcomp`` can pick the smallest rank that retains
a fraction :math:`\tau` of the energy (``compress.rank_for_energy``):

.. math::

   k(\tau) = \min\{\,k : E(k) \ge \tau\,\}.

By Eckart–Young this is the same as guaranteeing a relative Frobenius error of
at most :math:`\sqrt{1-\tau}`. For colour images one shared :math:`k` is
chosen from the energy summed over channels:
:math:`E(k) = \sum_c\sum_{i\le k}\sigma_i^{(c)2} / \sum_c \lVert A^{(c)}\rVert_F^2`.

Because the total energy is computed directly as
:math:`\lVert A\rVert_F^2 = \sum_{ij} a_{ij}^2`, the criterion stays valid
when only the leading singular values are known, as with the randomized SVD.

.. warning::

   For natural images :math:`\sigma_1` mostly encodes the average brightness,
   so :math:`E(1)` is often above 0.9. Useful thresholds therefore sit very
   close to 1 (0.999 and above). The adaptive block method avoids the problem
   by removing tile means first.


Computing the SVD I: Householder QR
-----------------------------------

``linalg.householder_qr`` factors :math:`A = QR` with orthonormal :math:`Q` and
upper-triangular :math:`R`. Both the Jacobi preconditioner and the randomized
range finder use it.

**Householder reflector.** For a unit vector :math:`v`,

.. math::

   H = I - 2 v v^T

is symmetric and orthogonal (:math:`H^2 = I`). It reflects space across the
hyperplane :math:`v^\perp`. To map a vector :math:`x` onto a multiple of
:math:`e_1`, choose

.. math::

   \tilde v = x + \operatorname{sign}(x_1)\,\lVert x\rVert_2\, e_1,
   \qquad v = \tilde v / \lVert \tilde v\rVert_2,
   \qquad H x = -\operatorname{sign}(x_1)\,\lVert x \rVert_2\, e_1 .

Using the sign of :math:`x_1` avoids subtracting two nearly equal numbers,
which would cause catastrophic cancellation.

**Algorithm.** For :math:`j = 1, \dots, p` apply the reflector that zeros
column :math:`j` below the diagonal to the trailing submatrix:

.. math::

   R \leftarrow H_p \cdots H_2 H_1 A, \qquad Q = H_1 H_2 \cdots H_p \begin{bmatrix} I_p \\ 0 \end{bmatrix}.

Each update is a rank-1 correction :math:`R \leftarrow R - 2v(v^TR)`, so the
:math:`H_j` are never formed. The cost is :math:`2mn^2 - \tfrac{2}{3}n^3`
flops. Householder QR is backward stable, and the computed :math:`Q` is
orthogonal to machine precision. Classical Gram–Schmidt does not guarantee
this.


Computing the SVD II: one-sided Jacobi
--------------------------------------

``linalg.jacobi_svd`` implements Hestenes' one-sided Jacobi method.

Idea
~~~~

Look for an orthogonal :math:`V` such that the columns of :math:`W = AV` are
mutually orthogonal. Once they are,

.. math::

   W = [w_1 \mid \dots \mid w_n], \quad \sigma_i = \lVert w_i \rVert_2, \quad u_i = w_i/\sigma_i
   \quad\Longrightarrow\quad A V = U\Sigma \;\Longrightarrow\; A = U\Sigma V^T.

:math:`V` is built as a product of plane rotations, each one making a single
pair of columns orthogonal.

The 2 × 2 rotation
~~~~~~~~~~~~~~~~~~

For columns :math:`w_p, w_q` let

.. math::

   \alpha = \lVert w_p\rVert^2, \qquad \beta = \lVert w_q\rVert^2, \qquad \gamma = w_p^T w_q .

Rotate the pair by :math:`\begin{bmatrix} c & s \\ -s & c\end{bmatrix}`,
:math:`c = \cos\theta`, :math:`s=\sin\theta`:

.. math::

   w_p' = c\,w_p - s\,w_q, \qquad w_q' = s\,w_p + c\,w_q .

The new inner product is

.. math::

   w_p'^T w_q' = cs(\alpha - \beta) + (c^2 - s^2)\gamma .

Setting it to zero and writing :math:`t = \tan\theta`,
:math:`\zeta = (\beta-\alpha)/(2\gamma)` gives the quadratic

.. math::

   t^2 + 2\zeta t - 1 = 0
   \quad\Longrightarrow\quad
   t = \frac{\operatorname{sign}(\zeta)}{|\zeta| + \sqrt{1+\zeta^2}},
   \qquad c = \frac{1}{\sqrt{1+t^2}}, \qquad s = ct .

The smaller root keeps :math:`|\theta| \le \pi/4`, which is essential for
convergence. Computing :math:`\sqrt{1+\zeta^2}` as ``hypot(1, ζ)`` prevents
overflow when :math:`\gamma` is tiny. The same rotation is applied to the
rows of the accumulated :math:`V`.

.. dropdown:: Why Jacobi converges
   :icon: light-bulb


   Consider the Gram matrix :math:`G = W^TW` and its off-diagonal mass
   :math:`\operatorname{off}(G) = \sum_{p\ne q} g_{pq}^2`. A rotation that zeros
   :math:`g_{pq}=\gamma` is an orthogonal similarity on :math:`G`, so it preserves
   :math:`\lVert G\rVert_F`. It moves exactly :math:`2\gamma^2` from the
   off-diagonal to the diagonal:

   .. math::

      \operatorname{off}(G') = \operatorname{off}(G) - 2\gamma^2 .

   The off-diagonal mass therefore decreases monotonically. For cyclic orderings
   it tends to zero (Forsythe & Henrici, 1960), and convergence becomes
   **quadratic** once :math:`\operatorname{off}(G)` is small. In practice this
   takes 6–12 sweeps.

Stopping rule
~~~~~~~~~~~~~

A pair is rotated only if

.. math::

   |\gamma| > \text{tol}\cdot\sqrt{\alpha\beta} \quad\text{and}\quad |\gamma| > \varepsilon^2 \lVert A\rVert_F^2,

with :math:`\text{tol} = 10^{-10}` and :math:`\varepsilon` the machine
epsilon. The relative test gives Jacobi its high relative accuracy. The
absolute floor stops endless rotations between columns that are numerically
zero. The method stops after a sweep in which no pair was rotated.

Round-robin parallel ordering
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

A sweep must visit all :math:`\binom{n}{2}` pairs. Rotations on *disjoint*
pairs commute, so the code groups pairs into :math:`n-1` rounds of
:math:`n/2` disjoint pairs. It uses the round-robin tournament (circle
method): fix player 0 and rotate the others one seat per round. Each round is
then a handful of vectorised array operations instead of :math:`n/2` Python
iterations. For odd :math:`n` a dummy index is added.

QR preconditioning
~~~~~~~~~~~~~~~~~~

For tall :math:`A` (:math:`m \ge n`) the code first computes :math:`A = QR`
and runs Jacobi on :math:`R^T` (:math:`n\times n`):

.. math::

   R^T = \hat U \Sigma \hat V^T
   \;\Longrightarrow\;
   A = QR = (Q\hat V)\,\Sigma\,\hat U^T .

This shrinks the working matrix from :math:`m\times n` to :math:`n\times n`,
and because :math:`R^T` is better scaled it roughly halves the number of sweeps
(Drmač & Veselić, 2008). Wide matrices are handled through
:math:`A^T = V\Sigma U^T`.

Batching
~~~~~~~~

All of the above runs on arrays of shape :math:`(\dots, m, n)`, so the colour
channels of an image, or the hundreds of tiles in block mode, are decomposed
in a single pass.

Complexity
~~~~~~~~~~

One sweep costs :math:`O(n^2 m)` flops (:math:`O(n^3)` after
preconditioning). The total is :math:`O(s\,n^3)` for :math:`s` sweeps, the
same order as LAPACK, but with a larger constant because the work is done
through NumPy rather than blocked BLAS-3 kernels.


Computing the SVD III: randomized SVD
-------------------------------------

``linalg.randomized_svd`` follows Halko, Martinsson & Tropp (2011). When only
the leading :math:`k \ll \min(m,n)` triplets are needed, a full SVD is wasted
work.

Algorithm
~~~~~~~~~

Let :math:`\ell = k + p` with oversampling :math:`p` (default 10) and
:math:`q` power iterations (default 2).

1. **Sample the range.** Draw a Gaussian matrix
   :math:`\Omega\in\mathbb{R}^{n\times\ell}` and form :math:`Y = A\Omega`. Its
   columns are random combinations of the columns of :math:`A`, so they
   concentrate on the dominant left singular directions.
2. **Power iterations.** Repeat :math:`q` times:
   :math:`Q \leftarrow \operatorname{qr}(A^T Q)`, then
   :math:`Q \leftarrow \operatorname{qr}(A Q)`. This samples
   :math:`(AA^T)^q A\Omega`, whose singular values are
   :math:`\sigma_j^{2q+1}`, so the spectral gap is sharpened. The
   re-orthonormalisation keeps the small singular directions from being lost
   to rounding.
3. **Project.** :math:`B = Q^TA \in \mathbb{R}^{\ell\times n}`. Since
   :math:`QQ^T` projects onto the captured range,
   :math:`A \approx QQ^TA = QB`.
4. **Small exact SVD.** :math:`B = \hat U \Sigma V^T` by Jacobi, which is
   cheap because :math:`B` has only :math:`\ell` rows.
5. **Lift.** :math:`U = Q\hat U`. Truncate to :math:`k` terms.

Error bounds
~~~~~~~~~~~~

With :math:`p\ge 2` and :math:`q=0` (Halko et al., Thm. 10.5):

.. math::

   \mathbb{E}\,\lVert A - QQ^TA\rVert_F \le \Big(1 + \frac{k}{p-1}\Big)^{1/2}
   \Big(\sum_{j>k}\sigma_j^2\Big)^{1/2}.

With :math:`q` power iterations (Cor. 10.10), in the spectral norm:

.. math::

   \mathbb{E}\,\lVert A - QQ^TA\rVert_2 \le
   \left[\Big(1 + \sqrt{\tfrac{k}{p-1}}\Big)\sigma_{k+1}^{2q+1}
   + \frac{e\sqrt{k+p}}{p}\Big(\sum_{j>k}\sigma_j^{2(2q+1)}\Big)^{1/2}\right]^{1/(2q+1)} .

As :math:`q` grows the bound approaches the optimal
:math:`\sigma_{k+1}`. The test suite checks that the error stays within 1 %
of the Eckart–Young optimum on a matrix with geometric spectral decay.

Cost
~~~~

:math:`O\big((2q+2)\,mn\ell\big)` for the products with :math:`A`, plus
:math:`O(m\ell^2)` for the QRs and :math:`O(n\ell^2)` for the small SVD. For
:math:`k = 100` on a :math:`640\times 640` image this is about 0.3 s, compared
with tens of seconds for an exact SVD.


Adaptive block-wise SVD
-----------------------

Global truncation gives every part of the image the same rank, so flat sky
pays for the detail in the foreground. ``compress.compress_blocks``, inspired by
PatchSVD (Golpayegani & Bouguila, 2024), allocates rank where it is needed.

1. **Tiling.** Split the image into :math:`b\times b` tiles :math:`T_t`. Edge
   tiles may be smaller.
2. **Centring.** Store each tile's per-channel mean :math:`\mu_t` (one number)
   and decompose :math:`\tilde T_t = T_t - \mu_t\mathbf{1}\mathbf{1}^T`.
   Without this step the mean would dominate :math:`\sigma_1` in every tile.
3. **Global rank allocation.** Let :math:`e_{t,i} = \sum_c \sigma_{t,i}^{(c)2}`
   be the energy of layer :math:`i` in tile :math:`t`. Pool all
   :math:`e_{t,i}`, sort them in decreasing order, and find the smallest
   threshold :math:`\theta` such that

   .. math::

      \sum_{e_{t,i}\ge\theta} e_{t,i} \;\ge\; \tau \sum_{t,i} e_{t,i} .

   Tile :math:`t` keeps :math:`k_t = |\{i : e_{t,i}\ge\theta\}|` layers. A
   flat tile has :math:`k_t = 0` and costs a single number.

**Why the threshold is optimal.** Within each tile the
:math:`e_{t,1}\ge e_{t,2}\ge\dots` are non-increasing, so by Eckart–Young the
best use of :math:`k_t` layers in tile :math:`t` is its first :math:`k_t`
layers. The retained energy is
:math:`\sum_t\sum_{i\le k_t} e_{t,i}`. Among all allocations with the same
total number of layers :math:`L=\sum_t k_t`, this sum is maximised by taking
the :math:`L` largest :math:`e_{t,i}` overall. The set
:math:`\{e_{t,i}\ge\theta\}` is exactly that, and it is automatically a prefix
in every tile. When all tiles have the same size, every layer costs the same
:math:`C(2b+1)` numbers, so the threshold rule is the optimal "water-filling"
allocation for a storage budget.

Storage is

.. math::

   S_{\text{blocks}} = \sum_t C\,\big(1 + k_t (b_h + b_w + 1)\big).

The trade-off: tile boundaries can show seams at low rank, and per-tile
overheads grow as :math:`b` shrinks.


Quality metrics
---------------

``svdcomp.metrics`` reports the following for original :math:`X` and
reconstruction :math:`Y`, each with :math:`N` samples.

**Mean squared error and PSNR**

.. math::

   \operatorname{MSE} = \frac{1}{N}\sum (x - y)^2, \qquad
   \operatorname{PSNR} = 10\log_{10}\frac{L^2}{\operatorname{MSE}}\ \text{dB}, \quad L = 255 .

Roughly, 30 dB is acceptable, 40 dB is hard to tell apart from the original,
and :math:`\infty` means lossless.

**Relative Frobenius error**

.. math::

   \varepsilon_{\text{rel}} = \frac{\lVert X - Y\rVert_F}{\lVert X\rVert_F}.

Before rounding to 8 bits, :math:`\varepsilon_{\text{rel}} = \sqrt{1-E(k)}`
by Eckart–Young.

**Structural similarity (SSIM)** (Wang, Bovik, Sheikh & Simoncelli, 2004)
compares local luminance, contrast and structure. With local means
:math:`\mu`, variances :math:`\sigma^2` and covariance :math:`\sigma_{xy}`
computed under an :math:`11\times 11` Gaussian window (:math:`\sigma = 1.5`):

.. math::

   \operatorname{SSIM}(x,y) =
   \frac{(2\mu_x\mu_y + C_1)(2\sigma_{xy} + C_2)}
        {(\mu_x^2 + \mu_y^2 + C_1)(\sigma_x^2 + \sigma_y^2 + C_2)},
   \qquad C_1 = (0.01L)^2,\; C_2 = (0.03L)^2 .

The local statistics come from :math:`\mathbb{E}_w[x^2] - \mu_x^2` and so on,
with the window applied as two 1-D convolutions (the Gaussian is separable).
The reported value is the mean of the SSIM map, averaged over channels.
SSIM is 1 for identical images.


A worked example
----------------

.. dropdown:: A 2 × 2 matrix by hand
   :icon: pencil
   :open:


   Take

   .. math::

      A = \begin{bmatrix} 3 & 0 \\ 4 & 5 \end{bmatrix},
      \qquad
      A^TA = \begin{bmatrix} 25 & 20 \\ 20 & 25 \end{bmatrix}.

   The eigenvalues of :math:`A^TA` are :math:`45` and :math:`5`, with eigenvectors
   :math:`v_1 = \tfrac{1}{\sqrt2}(1,1)^T` and :math:`v_2 = \tfrac{1}{\sqrt2}(1,-1)^T`.
   Hence :math:`\sigma_1 = 3\sqrt5`, :math:`\sigma_2 = \sqrt5` and

   .. math::

      u_1 = \frac{Av_1}{\sigma_1} = \frac{1}{\sqrt{10}}\begin{bmatrix}1\\3\end{bmatrix},
      \qquad
      u_2 = \frac{Av_2}{\sigma_2} = \frac{1}{\sqrt{10}}\begin{bmatrix}3\\-1\end{bmatrix}.

   The rank-1 approximation is

   .. math::

      A_1 = \sigma_1 u_1 v_1^T = \frac{3\sqrt5}{\sqrt{20}}\begin{bmatrix}1&1\\3&3\end{bmatrix}
          = \begin{bmatrix}1.5&1.5\\4.5&4.5\end{bmatrix},

   and its error is
   :math:`\lVert A - A_1\rVert_F^2 = 1.5^2 + 1.5^2 + 0.5^2 + 0.5^2 = 5 = \sigma_2^2`,
   exactly as Eckart–Young predicts. The retained energy is
   :math:`E(1) = 45/50 = 90\%`.

Complexity summary
------------------

.. list-table::
   :header-rows: 1

   * - Step
     - Cost (one :math:`m\times n` channel, :math:`m\ge n`)
   * - Householder QR
     - :math:`2mn^2 - \tfrac23 n^3`
   * - One-sided Jacobi (after QR)
     - :math:`O(s\, n^3)`, :math:`s \approx 6\text{–}12` sweeps
   * - Randomized SVD
     - :math:`O((2q+2)\, m n (k+p))`
   * - Rank-:math:`k` reconstruction
     - :math:`2kmn`
   * - SSIM
     - :math:`O(mn\cdot w)` with window :math:`w = 11`


References
----------

* C. Eckart and G. Young, *The approximation of one matrix by another of lower rank*, Psychometrika 1 (1936).
* M. R. Hestenes, *Inversion of matrices by biorthogonalization and related results*, J. SIAM 6 (1958).
* G. E. Forsythe and P. Henrici, *The cyclic Jacobi method for computing the principal values of a complex matrix*, Trans. AMS 94 (1960).
* Z. Drmač and K. Veselić, *New fast and accurate Jacobi SVD algorithm I/II*, SIAM J. Matrix Anal. Appl. 29 (2008).
* N. Halko, P.-G. Martinsson and J. A. Tropp, *Finding structure with randomness*, SIAM Review 53 (2011). `arXiv:0909.4061 <https://arxiv.org/abs/0909.4061>`_
* Z. Wang, A. C. Bovik, H. R. Sheikh and E. P. Simoncelli, *Image quality assessment: from error visibility to structural similarity*, IEEE TIP 13 (2004).
* Z. Golpayegani and N. Bouguila, *PatchSVD: A non-uniform SVD-based image compression algorithm* (2024).
* J. Jiang, *Image compression using singular value decomposition* (2025).
* R. A. Sadek, *SVD based image processing applications: state of the art, contributions and research challenges* (2012).
* L. N. Trefethen and D. Bau, *Numerical Linear Algebra*, SIAM (1997), Lectures 4–5, 10, 31.
* G. H. Golub and C. F. Van Loan, *Matrix Computations*, 4th ed., Johns Hopkins (2013), §8.5–8.6.
