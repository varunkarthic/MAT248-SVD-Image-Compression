"""Browser end-to-end fixtures: a live Flask server and a Playwright browser.

The tests skip (they are never reported as passed) when Playwright or a Chromium-family
browser is unavailable. Install with ``pip install -e ".[e2e]"``; on CI also run
``playwright install chromium``. Set ``SVDLAB_BROWSER_CHANNEL=chrome|msedge`` to pick an installed browser.
"""

import os
import threading

import pytest

playwright_sync = pytest.importorskip("playwright.sync_api", reason="playwright is not installed")

from werkzeug.serving import make_server  # noqa: E402

from svdcomp import web  # noqa: E402


@pytest.fixture(scope="session")
def base_url():
    server = make_server("127.0.0.1", 0, web.create_app(cache_size=16), threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture(scope="session")
def browser():
    with playwright_sync.sync_playwright() as p:
        channel = os.environ.get("SVDLAB_BROWSER_CHANNEL")
        attempts = [{"channel": channel}] if channel else [{}, {"channel": "chrome"}, {"channel": "msedge"}]
        browser, last = None, None
        for kwargs in attempts:
            try:
                browser = p.chromium.launch(**kwargs)
                break
            except Exception as exc:  # noqa: BLE001 - try the next browser
                last = exc
        if browser is None:
            pytest.skip(f"no usable Chromium-family browser: {last}")
        yield browser
        browser.close()


class Session:
    """A page plus collectors for console errors and external requests."""

    def __init__(self, browser, base_url, viewport=None, reduced_motion=False, intro=False):
        self.base_url = base_url
        self.context = browser.new_context(viewport=viewport or {"width": 1440, "height": 900}, accept_downloads=True,
                                           reduced_motion="reduce" if reduced_motion else "no-preference")
        self.page = self.context.new_page()
        self.errors, self.external = [], []
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        self.page.on("request", lambda r: self.external.append(r.url)
                     if not r.url.startswith((base_url, "data:", "blob:", "about:")) else None)
        self.page.goto(base_url + ("/" if intro else "/?intro=0"))

    def close(self):
        self.context.close()


@pytest.fixture
def session(browser, base_url):
    made = []

    def make(**kwargs):
        s = Session(browser, base_url, **kwargs)
        made.append(s)
        return s

    yield make
    for s in made:
        s.close()
