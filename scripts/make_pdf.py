"""Render the guides in documentation/ to PDF (needs playwright + Chrome/Chromium).

    python scripts/make_pdf.py                 # svd-explained.pdf and complete-guide.pdf
"""

from pathlib import Path

from playwright.sync_api import sync_playwright

DOC = Path(__file__).resolve().parents[1] / "documentation"

with sync_playwright() as p:
    try:
        browser = p.chromium.launch(channel="chrome")
    except Exception:  # noqa: BLE001
        browser = p.chromium.launch()
    page = browser.new_page()
    for name in ("svd-explained", "complete-guide"):
        page.goto((DOC / f"{name}.html").as_uri())
        page.wait_for_load_state("load")
        page.pdf(path=str(DOC / f"{name}.pdf"), format="A4", print_background=True)
        print("wrote", name + ".pdf")
    browser.close()
