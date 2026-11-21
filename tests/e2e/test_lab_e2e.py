"""Browser end-to-end tests of SVD LAB (real Chrome/Chromium via Playwright)."""

import io
import pathlib
import re

import numpy as np
import pytest

from svdcomp.formats import encode_png

expect = pytest.importorskip("playwright.sync_api").expect
ARTIFACTS = pathlib.Path(__file__).parent / "artifacts"
SAMPLES = pathlib.Path(__file__).parents[2] / "svdcomp" / "demo_assets" / "samples"


def tid(page, name):
    return page.get_by_test_id(name)


def load_sample(page, sample_id):
    tid(page, f"sample-{sample_id}").click()
    expect(page.locator("#image-meta")).to_be_visible(timeout=15000)


def compute_svd(page, method="exact"):
    page.select_option("#method", method)
    page.click("#run-svd")
    expect(page.locator("#rank-slider")).to_be_enabled(timeout=90000)
    expect(page.locator("#r-energy")).not_to_have_text("", timeout=30000)


def number(text):
    return float(re.search(r"-?\d+(?:[.,]\d+)*", text.replace(",", "")).group())


# ------------------------------------------------------------------ landing and intro

def test_landing_without_intro(session):
    s = session()
    expect(s.page.locator("h1")).to_contain_text("SVD")
    expect(s.page.locator("#intro")).to_be_hidden()
    assert s.errors == []


def test_intro_plays_skips_and_replays(session):
    s = session(intro=True)
    page = s.page
    expect(tid(page, "intro-overlay")).to_be_visible()
    tid(page, "intro-skip").click()
    expect(tid(page, "intro-overlay")).to_be_hidden()
    page.click("#btn-replay")
    expect(tid(page, "intro-overlay")).to_be_visible()
    page.keyboard.press("Escape")
    expect(tid(page, "intro-overlay")).to_be_hidden()
    assert s.errors == []


def test_intro_with_reduced_motion_is_static_and_skippable(session):
    s = session(intro=True, reduced_motion=True)
    expect(s.page.locator("h1")).to_be_visible()
    s.page.click("#btn-replay")
    expect(tid(s.page, "intro-skip")).to_be_visible()
    tid(s.page, "intro-skip").click()
    expect(tid(s.page, "intro-overlay")).to_be_hidden()


# ------------------------------------------------------------------ the laboratory

def test_gallery_has_every_sample_with_working_thumbnails(session):
    s = session()
    page = s.page
    cards = page.locator("[data-sample-id]")
    expect(cards).to_have_count(9)
    page.locator("#gallery").scroll_into_view_if_needed()
    page.wait_for_timeout(1500)
    broken = page.evaluate("""async () => {
        const imgs = [...document.querySelectorAll('[data-sample-id] img')];
        imgs.forEach(i => i.scrollIntoView());
        await new Promise(r => setTimeout(r, 1200));
        return imgs.filter(i => !i.complete || i.naturalWidth === 0).length;
    }""")
    assert broken == 0


def test_signature_animation_is_synchronised(session):
    s = session()
    page = s.page
    load_sample(page, "tiny-face")
    compute_svd(page, "exact")
    page.fill("#rank-input", "1")
    page.press("#rank-input", "Enter")
    expect(tid(page, "r-k")).to_contain_text("1")
    first_energy = number(tid(page, "r-energy").inner_text())
    tid(page, "btn-play").click()
    expect(tid(page, "btn-play")).to_have_attribute("aria-pressed", "true")
    for _ in range(60):                                   # the explanation steps come first
        page.wait_for_timeout(250)
        if int(number(tid(page, "r-k").inner_text())) > 2:
            break
    tid(page, "btn-play").click()                         # pause
    expect(tid(page, "btn-play")).to_have_attribute("aria-pressed", "false")
    k = int(number(tid(page, "r-k").inner_text()))
    assert k > 1
    assert number(tid(page, "r-energy").inner_text()) > first_energy
    assert page.locator("#equation").inner_text().count(str(k)) >= 1      # equation shows the same k
    assert page.input_value("#rank-input") == str(k)
    page.wait_for_timeout(600)
    assert int(number(tid(page, "r-k").inner_text())) == k                # paused means paused
    assert s.errors == []


def test_manual_rank_compare_component_and_download(session, tmp_path):
    s = session()
    page = s.page
    load_sample(page, "tiny-face")
    compute_svd(page, "exact")
    page.fill("#rank-input", "3")
    page.press("#rank-input", "Enter")
    expect(tid(page, "r-k")).to_contain_text("3")
    # relative error falls as the rank grows
    e3 = number(tid(page, "r-rel").inner_text())
    page.fill("#rank-input", "8")
    page.press("#rank-input", "Enter")
    expect(tid(page, "r-k")).to_contain_text("8")
    assert number(tid(page, "r-rel").inner_text()) < e3
    # divider keyboard control
    handle = page.locator("#compare-handle")
    handle.focus()
    before = handle.get_attribute("aria-valuenow")
    page.keyboard.press("Home")
    assert handle.get_attribute("aria-valuenow") != before or before == "0"
    # component view
    page.check("#show-component")
    expect(page.locator("#component-view")).to_be_visible()
    # download
    with page.expect_download() as info:
        tid(page, "btn-download").click()
    path = tmp_path / "out.png"
    info.value.save_as(path)
    assert path.read_bytes().startswith(b"\x89PNG") and "rank-8" in info.value.suggested_filename
    for chart in ("sigma", "energy", "error", "quality", "storage"):
        expect(page.locator(f"#chart-{chart} svg").first).to_be_visible()
    assert s.errors == []


def test_results_report_honest_storage(session):
    s = session()
    page = s.page
    load_sample(page, "tiny-face")
    compute_svd(page, "exact")
    text = page.locator("#results").inner_text().lower()
    assert "not a file-size" in text or "not a file size" in text
    assert "jpeg" in text


def test_upload_custom_png_and_invalid_file(session, tmp_path):
    s = session()
    page = s.page
    img = np.random.default_rng(1).integers(0, 256, (20, 30, 3), dtype=np.uint8)
    good = tmp_path / "mine.png"
    good.write_bytes(encode_png(img))
    page.set_input_files("#file-input", str(good))
    expect(page.locator("#image-meta")).to_contain_text("30")
    expect(page.locator("#image-meta")).to_contain_text("20")
    bad = tmp_path / "fake.png"
    bad.write_bytes(b"<html>not an image</html>")
    page.set_input_files("#file-input", str(bad))
    expect(page.locator("#lab-error")).to_be_visible()
    expect(page.locator("#image-meta")).to_contain_text("30")     # previous image survives
    compute_svd(page, "randomized")
    assert s.errors == [] or all("400" in e for e in s.errors)    # the rejected upload logs one 400


def test_file_names_are_not_html(session, tmp_path):
    """Entities in a file name must appear literally (textContent), never be interpreted as markup."""
    s = session()
    name = "a&lt;b&gt;&amp;'onerror=window.__pwn=1.png"
    path = tmp_path / name
    path.write_bytes(encode_png(np.zeros((8, 8), np.uint8)))
    s.page.set_input_files("#file-input", str(path))
    expect(s.page.locator("#image-meta")).to_be_visible()
    assert "&lt;b&gt;" in s.page.locator("#lab").inner_text()
    assert s.page.evaluate("() => window.__pwn") is None


def test_adaptive_blocks_and_heatmap(session):
    s = session()
    page = s.page
    load_sample(page, "shapes")
    page.click("#tab-blocks")
    page.click("#run-blocks")
    expect(page.locator("#heatmap")).to_be_visible(timeout=60000)
    expect(page.locator("#heat-caption")).not_to_be_empty()


# ------------------------------------------------------------------ offline, layout


def test_fully_offline_no_external_requests(session):
    s = session()
    page = s.page
    load_sample(page, "tiny-face")
    compute_svd(page, "exact")
    page.reload()
    page.wait_for_timeout(500)
    assert s.external == []


VIEWPORTS = [(1920, 1080), (1440, 900), (1280, 800), (768, 1024), (390, 844), (320, 568)]


@pytest.mark.parametrize("width,height", VIEWPORTS)
def test_no_horizontal_overflow_and_screenshots(session, width, height):
    s = session(viewport={"width": width, "height": height})
    page = s.page
    ARTIFACTS.mkdir(exist_ok=True)
    for detail in (False,):
        over = page.evaluate("""() => {
            const w = document.documentElement.clientWidth;
            return [...document.querySelectorAll('main section, header, footer')]
              .filter(e => e.scrollWidth > w + 1).map(e => e.id || e.className + ':' + e.scrollWidth);
        }""")
        assert over == [], f"overflow at {width}px (details={detail}): {over}"
    page.screenshot(path=str(ARTIFACTS / f"landing-{width}x{height}.png"))
    assert s.errors == []


def test_security_headers_present(session):
    s = session()
    resp = s.page.request.get(s.base_url + "/")
    assert "script-src 'self'" in resp.headers["content-security-policy"]


def test_acceptance_run_through(session, tmp_path):
    """A condensed version of the professor demonstration."""
    s = session(intro=True)
    page = s.page
    tid(page, "intro-skip").click()
    load_sample(page, "checkerboard")
    compute_svd(page, "exact")
    page.fill("#rank-input", "2")
    page.press("#rank-input", "Enter")
    expect(tid(page, "r-energy")).to_contain_text("100")            # checkerboard is exactly rank 2
    load_sample(page, "photo-gray")
    compute_svd(page, "randomized")
    tid(page, "btn-play").click()
    page.wait_for_timeout(1500)
    tid(page, "btn-play").click()
    with page.expect_download():
        tid(page, "btn-download").click()
    page.reload()
    load_sample(page, "tiny-face")
    compute_svd(page, "exact")
    assert [e for e in s.errors] == []
    assert s.external == []
