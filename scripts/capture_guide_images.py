"""Screenshots and figures for documentation/complete-guide.html (real UI + real engine output).

    python scripts/capture_guide_images.py
"""

import sys
import threading
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from svdcomp import web  # noqa: E402
from svdcomp.compress import decompose, reconstruct  # noqa: E402
from svdcomp.formats import encode_png, read_image  # noqa: E402

OUT = ROOT / "documentation" / "guide_images"


def rank_strip():
    """Original and rank 1, 5, 20, 50 reconstructions of the grayscale photo, side by side (real engine)."""
    img = read_image(ROOT / "svdcomp" / "demo_assets" / "samples" / "photo-gray.png")
    f = decompose(img, "exact")
    tiles = [img] + [reconstruct(f, k) for k in (1, 5, 20, 50)]
    gap = np.full((img.shape[0], 8), 255, np.uint8)
    row = tiles[0]
    for t in tiles[1:]:
        row = np.hstack([row, gap, t])
    (OUT / "rank-strip.png").write_bytes(encode_png(row))
    print("wrote rank-strip.png")


def shot(page, selector, name, pad=0):
    el = page.locator(selector).first
    el.scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    el.screenshot(path=str(OUT / f"{name}.png"))
    print("wrote", name)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rank_strip()
    server = make_server("127.0.0.1", 0, web.create_app(), threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome")
        except Exception:  # noqa: BLE001
            browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.goto(base + "/")
        page.wait_for_selector("body[data-ready]", state="attached")
        page.wait_for_timeout(3300)
        page.screenshot(path=str(OUT / "intro-open.png"))
        print("wrote intro-open")
        page.click("[data-testid=intro-skip]")
        page.add_style_tag(content=".site-header{display:none!important}")   # sticky bar would overlap element shots
        page.wait_for_timeout(700)
        shot(page, "#dropzone", "upload-box")
        shot(page, "#gallery", "gallery")
        page.click("[data-testid=sample-photo-gray]")
        page.wait_for_timeout(1700)
        page.screenshot(path=str(OUT / "intro-processing.png"))
        print("wrote intro-processing")
        page.click("[data-testid=intro-skip]")
        page.wait_for_timeout(600)
        page.select_option("#method", "exact")
        page.click("#run-svd")
        for _ in range(240):
            page.wait_for_timeout(500)
            if not page.locator("#rank-slider").is_disabled():
                break
        page.fill("#rank-input", "20")
        page.press("#rank-input", "Enter")
        page.wait_for_timeout(2500)
        shot(page, ".lab-summary", "summary")
        shot(page, "#lab-stage", "comparison")
        shot(page, ".lab-side", "controls")
        page.check("#show-component")
        page.wait_for_timeout(1500)
        shot(page, "#component-view", "component")
        for name in ("sigma", "energy", "error", "quality", "storage"):
            shot(page, f"#chart-{name}", f"chart-{name}")
        page.click("[data-testid=sample-shapes]")
        page.wait_for_timeout(300)
        page.click("[data-testid=intro-skip]")
        page.wait_for_timeout(500)
        page.click("#tab-blocks")
        page.click("#run-blocks")
        page.wait_for_timeout(5000)
        shot(page, "#panel-blocks", "blocks")
        browser.close()
    server.shutdown()


if __name__ == "__main__":
    main()
