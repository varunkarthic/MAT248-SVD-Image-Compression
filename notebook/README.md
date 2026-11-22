# SVD image compression notebook (MAT248)

`svd_image_compression.ipynb` is a self-contained, teaching-focused walkthrough of SVD-based image compression: images as matrices, the SVD and rank-one layers, a from-scratch SVD (Jacobi eigenvalue method on AᵀA), a hand-checkable 2x2 example, low-rank approximations, singular value decay and energy, Eckart-Young, storage/compression ratio, colour images, an optional slider, and exercises.

The SVD is implemented by hand; `np.linalg.svd` appears only in one labelled verification cell. It reads the sample images in `../svdcomp/demo_assets/samples/` and does not touch the Flask app.

## Run

```bash
pip install numpy matplotlib jupyter        # ipywidgets optional (enables the slider)
cd notebook
jupyter notebook svd_image_compression.ipynb
```

Or execute headlessly: `jupyter nbconvert --to notebook --execute --inplace svd_image_compression.ipynb` (about 15 s; the 256x256 SVD takes ~3 s per channel).
