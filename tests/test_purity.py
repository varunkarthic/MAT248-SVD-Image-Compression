"""The project rule: all math and image logic is ours. No PIL, no np.linalg."""

from pathlib import Path

PKG = Path(__file__).resolve().parents[1] / "svdcomp"
BANNED = ("np.linalg", "numpy.linalg", "import PIL", "from PIL", "scipy", "cv2", "imageio", "skimage")


def test_package_uses_no_prebuilt_math_or_imaging():
    for path in PKG.rglob("*.py"):
        text = path.read_text()
        for word in BANNED:
            assert word not in text, f"{path.name} uses {word}"
