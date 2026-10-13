"""Sphinx configuration for svdcomp."""

import os
import sys

sys.path.insert(0, os.path.abspath(".."))

project = "svdcomp"
author = "Varun Karthic"
copyright = "2026, Varun Karthic"
release = "1.0.0"

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "sphinx.ext.mathjax",
    "sphinx.ext.viewcode",
]
autodoc_member_order = "bysource"
napoleon_numpy_docstring = True
html_theme = "sphinx_rtd_theme"
html_title = "svdcomp: SVD Image Compression"
exclude_patterns = ["_build"]
