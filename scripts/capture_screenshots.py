"""Capture the README/documentation screenshots of the real running UI (needs playwright + Chrome/Chromium).

    python scripts/capture_screenshots.py
"""

import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from svdcomp import web  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "docs" / "_static" / "screenshots"


def shot(page, name, selector=None, full=False):
    target = page.locator(selector) if selector else page
    path = OUT / f"{name}.png"
    if selector:
        target.scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        target.screenshot(path=str(path))
    else:
        page.screenshot(path=str(path), full_page=full)
    print("wrote", path.name)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = make_server("127.0.0.1", 0, web.create_app(), threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception:  # noqa: BLE001
            browser = p.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(base + "/?intro=0")
        page.wait_for_selector("body[data-ready]", state="attached")
        shot(page, "01-hero")
        shot(page, "02-learn-pixels", "#ch-3")
        shot(page, "03-worked-example", "#worked")
        page.click("[data-testid=sample-photo-gray]")
        page.select_option("#method", "randomized")
        page.click("#run-svd")
        page.wait_for_function("document.querySelector('#rank-slider') && !document.querySelector('#rank-slider').disabled", timeout=90000) \
            if False else page.wait_for_timeout(6000)
        page.fill("#rank-input", "20")
        page.press("#rank-input", "Enter")
        page.wait_for_timeout(2500)
        shot(page, "04-laboratory", "#lab")
        shot(page, "05-charts", "#chart-sigma")
        page.click("#tab-blocks")
        page.click("[data-testid=sample-shapes]")
        page.click("#tab-blocks")
        page.click("#run-blocks")
        page.wait_for_timeout(5000)
        shot(page, "06-adaptive-blocks", "#lab")
        page.click("#btn-present")
        page.wait_for_timeout(1800)
        shot(page, "07-presentation-mode")
        page.click("[data-testid=present-exit]")
        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        mobile.goto(base + "/?intro=0")
        mobile.wait_for_selector("body[data-ready]", state="attached")
        shot(mobile, "08-mobile")
        browser.close()
    server.shutdown()


if __name__ == "__main__":
    main()
