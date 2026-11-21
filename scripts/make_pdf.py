"""Render documentation/svd-explained.html to documentation/svd-explained.pdf (needs playwright + Chrome/Chromium)."""

from pathlib import Path

from playwright.sync_api import sync_playwright

DOC = Path(__file__).resolve().parents[1] / "documentation"

with sync_playwright() as p:
    try:
        browser = p.chromium.launch()
    except Exception:  # noqa: BLE001
        browser = p.chromium.launch(channel="chrome")
    page = browser.new_page()
    page.goto((DOC / "svd-explained.html").as_uri())
    page.pdf(path=str(DOC / "svd-explained.pdf"), format="A4", print_background=True)
    browser.close()
print("wrote", DOC / "svd-explained.pdf")
