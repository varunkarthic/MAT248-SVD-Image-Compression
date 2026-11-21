"""Backend for the SVD Lab: curves, components, samples, worked example, upload metadata."""

import base64
import io

import numpy as np
import pytest

from svdcomp import lab, samples, web
from svdcomp.compress import decompose
from svdcomp.formats import decode_image, decode_png, encode_png


@pytest.fixture
def client():
    return web.create_app(cache_size=4).test_client()


def png_of(url):
    return decode_png(base64.b64decode(url.split(",", 1)[1]))


def upload(client, img, **form):
    data = {"image": (io.BytesIO(encode_png(img)), "photo.png"), **form}
    return client.post("/api/upload", data=data, content_type="multipart/form-data")


RNG = np.random.default_rng(7)
IMG = RNG.integers(0, 256, (20, 28, 3), dtype=np.uint8)
GRAY = RNG.integers(0, 256, (18, 12), dtype=np.uint8)


# ------------------------------------------------------------------ the 2 x 2 worked example

def test_worked_example_every_displayed_number():
    w = lab.worked_example()
    np.testing.assert_allclose(w["AtA"], [[10, 6], [6, 10]])
    np.testing.assert_allclose(w["eigenvalues"], [16, 4], atol=1e-12)
    np.testing.assert_allclose(w["sigma"], [4, 2], atol=1e-12)
    h = 1 / np.sqrt(2)
    np.testing.assert_allclose(w["U"], [[h, h], [h, -h]], atol=1e-12)
    np.testing.assert_allclose(w["Vt"], [[h, h], [h, -h]], atol=1e-12)
    np.testing.assert_allclose(w["A1"], [[2, 2], [2, 2]], atol=1e-12)
    np.testing.assert_allclose(w["residual"], [[1, -1], [-1, 1]], atol=1e-12)
    np.testing.assert_allclose(w["rank_one_terms"][1], [[1, -1], [-1, 1]], atol=1e-12)
    assert w["residual_frobenius"] == pytest.approx(2.0)
    assert w["energy_rank1"] == pytest.approx(0.8)          # 16 / (16 + 4)
    assert w["reconstruction_error"] < 1e-12
    assert w["stored_values_rank1"] == 5 and w["original_values"] == 4   # k(m+n+1) = 5 > 4: no saving


def test_worked_example_independent_of_engine():
    """Check the closed form by hand: A^T A has eigenvectors (1,1), (1,-1) with eigenvalues 16, 4."""
    A = np.array([[3.0, 1.0], [1.0, 3.0]])
    for vec, lam in (([1, 1], 16), ([1, -1], 4)):
        np.testing.assert_allclose(A.T @ A @ vec, lam * np.array(vec))
    w = lab.worked_example()
    U, s, Vt = (np.array(w[x]) for x in ("U", "sigma", "Vt"))
    np.testing.assert_allclose(U @ np.diag(s) @ Vt, A, atol=1e-12)
    np.testing.assert_allclose(U.T @ U, np.eye(2), atol=1e-12)


def test_worked_example_route(client):
    assert client.get("/api/worked-example").get_json()["sigma"][0] == pytest.approx(4)


# ------------------------------------------------------------------ curves

def test_spectral_curves_match_eckart_young():
    f = decompose(IMG, "exact")
    c = lab.spectral_curves(f, "exact")
    assert c["k"] == list(range(1, 21)) and c["exact"]
    assert c["energy"][-1] == pytest.approx(1.0)
    assert np.all(np.diff(c["energy"]) >= 0) and np.all(np.diff(c["spectral_error"]) <= 1e-9)
    from svdcomp.compress import reconstruct
    for k in (1, 5, 19):
        approx = reconstruct(f, k).astype(float)
        # float reconstruction error equals sqrt(sum of discarded sigma^2); only 8-bit rounding adds noise
        stack = (f.U[:, :, :k] * f.s[:, None, :k]) @ f.Vt[:, :k, :]
        exact = np.sqrt(np.sum((np.moveaxis(IMG, 2, 0).astype(float) - stack) ** 2))
        assert c["spectral_error"][k - 1] == pytest.approx(exact, rel=1e-6)
        assert approx.shape == IMG.shape
    assert c["stored_values"][4] == 3 * 5 * (20 + 28 + 1)


def test_zero_image_has_no_division_by_zero():
    f = decompose(np.zeros((6, 5), dtype=np.uint8), "exact")
    c = lab.spectral_curves(f)
    assert c["energy"] == [1.0] * 5 and c["spectral_error"] == [0.0] * 5


def test_sample_ranks_include_ends():
    assert lab.sample_ranks(5) == [1, 2, 3, 4, 5]
    ks = lab.sample_ranks(300, 12)
    assert ks[0] == 1 and ks[-1] == 300 and len(ks) <= 12 and ks == sorted(set(ks))


def test_pixel_curves_values_are_measured():
    f = decompose(GRAY, "exact")
    rows = lab.pixel_curves(GRAY, f, points=6)
    assert rows[-1]["k"] == 12 and rows[-1]["mse"] < 1e-6      # full rank reproduces the image
    assert rows[-1]["psnr"] is None or rows[-1]["psnr"] > 90
    assert rows[0]["ssim"] < rows[-1]["ssim"]


# ------------------------------------------------------------------ rank-one components

def test_component_matches_definition_and_sums_to_image():
    f = decompose(GRAY, "exact")
    rgb, info = lab.component_image(f, 1)
    assert rgb.shape == GRAY.shape + (3,) and info["i"] == 1
    assert info["sigma"][0] == pytest.approx(f.s[0, 0])
    assert info["energy_cumulative"] == pytest.approx(info["energy_share"])
    expected = f.s[0, 0] * np.outer(f.U[0, :, 0], f.Vt[0, 0])
    assert info["vmax"] == pytest.approx(np.abs(expected).max())
    _, last = lab.component_image(f, f.max_rank)
    assert last["energy_cumulative"] == pytest.approx(1.0)


def test_component_diverging_colours_have_paper_midpoint():
    img = lab._colorize(np.array([[-1.0, 0.0, 1.0]]), 1.0)[0]
    assert tuple(img[1]) == lab._MID and tuple(img[0]) == lab._NEG and tuple(img[2]) == lab._POS


def test_difference_image_zero_error():
    rgb, top = lab.difference_image(GRAY, GRAY)
    assert top == 0 and np.all(rgb == rgb[0, 0])


# ------------------------------------------------------------------ API

def test_api_flow_with_new_fields(client):
    info = upload(client, IMG).get_json()
    assert info["source"] == {"format": "png", "bytes": len(encode_png(IMG)), "converted_in_browser": False,
                              "single_frame": False}
    token = info["token"]
    spec = client.post("/api/decompose", data={"token": token, "method": "exact"}).get_json()
    curves = spec["curves"]
    assert curves["energy"] == pytest.approx(spec["energy"], abs=1e-6) and spec["shape"] == [20, 28]
    first = client.get(f"/api/reconstruct?token={token}&k=3&diff=1").get_json()
    second = client.get(f"/api/reconstruct?token={token}&k=3").get_json()
    assert first["image"] == second["image"] and "difference" in first and "difference" not in second
    assert first["spectral_error"] == pytest.approx(curves["spectral_error"][2])
    assert first["png_bytes"] > 0 and first["metrics"]["frobenius_error"] > 0
    comp = client.get(f"/api/component?token={token}&i=2").get_json()
    assert comp["i"] == 2 and png_of(comp["image"]).shape == (20, 28, 3)
    pts = client.get(f"/api/curves?token={token}&points=5").get_json()["points"]
    assert [p["k"] for p in pts] == lab.sample_ranks(20, 5)


@pytest.mark.parametrize("path", ["/api/component?token=nope&i=1", "/api/curves?token=nope",
                                  "/api/reconstruct?token=nope&k=1"])
def test_invalid_tokens(client, path):
    assert client.get(path).status_code == 404


def test_validation_and_no_factors(client):
    token = upload(client, GRAY).get_json()["token"]
    assert client.get(f"/api/component?token={token}&i=1").status_code == 400    # not decomposed
    client.post("/api/decompose", data={"token": token, "method": "exact"})
    assert client.get(f"/api/component?token={token}&i=99").status_code == 400
    assert client.get(f"/api/component?token={token}&i=abc").status_code == 400
    assert client.get(f"/api/reconstruct?token={token}&k=0").status_code == 400


def test_redecompose_clears_cached_reconstructions(client):
    token = upload(client, GRAY).get_json()["token"]
    client.post("/api/decompose", data={"token": token, "method": "randomized", "rank": 3})
    a = client.get(f"/api/reconstruct?token={token}&k=3").get_json()
    client.post("/api/decompose", data={"token": token, "method": "exact"})
    b = client.get(f"/api/reconstruct?token={token}&k=3").get_json()
    assert a["spectral_error"] != b["spectral_error"] or a["image"] != b["image"]


def test_upload_metadata_for_browser_converted_files(client):
    info = upload(client, GRAY, source_format="gif").get_json()
    assert info["source"]["format"] == "gif" and info["source"]["converted_in_browser"]
    assert info["source"]["single_frame"]
    weird = upload(client, GRAY, source_format="<script>").get_json()
    assert weird["source"]["format"] == "png" and not weird["source"]["converted_in_browser"]


def test_extension_is_never_trusted(client):
    res = client.post("/api/upload", data={"image": (io.BytesIO(b"<html>not an image</html>"), "cat.png")},
                      content_type="multipart/form-data")
    assert res.status_code == 400 and "unsupported" in res.get_json()["error"]
    empty = client.post("/api/upload", data={"image": (io.BytesIO(b""), "e.png")}, content_type="multipart/form-data")
    assert empty.status_code == 400 and "empty" in empty.get_json()["error"]
    res = upload(client, GRAY)
    assert "photo.png" not in res.get_data(as_text=True)          # file names are never echoed back


def test_truncated_and_corrupt_uploads_are_graceful(client):
    good = encode_png(GRAY)
    for blob in (good[:30], good[:-6], good[:40] + b"\x00" + good[41:]):
        res = client.post("/api/upload", data={"image": (io.BytesIO(blob), "x.png")}, content_type="multipart/form-data")
        assert res.status_code == 400 and "error" in res.get_json()
    assert client.get("/").status_code == 200


def test_security_headers(client):
    res = client.get("/")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert "script-src 'self'" in res.headers["Content-Security-Policy"]
    assert "http" not in res.headers["Content-Security-Policy"]     # nothing external is allowed


# ------------------------------------------------------------------ gallery

def test_manifest_matches_files_and_decodes():
    items = samples.load_manifest()
    assert len(items) >= 8 and len({i["id"] for i in items}) == len(items)
    for item in items:
        data = (samples.SAMPLES / item["file"]).read_bytes()
        img = decode_image(data)
        assert img.shape[:2] == (item["height"], item["width"])
        assert (1 if img.ndim == 2 else img.shape[2]) == item["channels"]
        assert item["title"] and item["description"] and item["why"]
    assert {i["channels"] for i in items} == {1, 3}


def test_synthetic_samples_are_reproducible():
    for sid, make, *_ in samples.CATALOG:
        if sid.startswith("photo"):
            continue
        np.testing.assert_array_equal(make(), make())
        np.testing.assert_array_equal(make(), decode_image((samples.SAMPLES / f"{sid}.png").read_bytes()))


def test_known_ranks_of_samples():
    def numerical_rank(img, tol=1e-2):
        s = decompose(img, "exact").s[0]
        return int(np.sum(s > tol * s[0]))
    assert numerical_rank(samples.checkerboard()) == 2
    assert numerical_rank(samples.gradient()) <= 3                    # rank 2 plus rounding noise
    f = decompose(samples.low_rank(), "exact")
    assert f.s[0, 4] / f.s[0, 0] > 1e-3 and f.s[0, 5] / f.s[0, 0] < 5e-3   # five real terms, then rounding noise


def test_gallery_routes_and_every_sample_runs_through_svd(client):
    listing = client.get("/api/samples").get_json()["samples"]
    assert len(listing) == len(samples.CATALOG)
    for item in listing:
        assert client.get(item["url"]).status_code == 200
        info = client.post(f"/api/sample/{item['id']}").get_json()
        assert (info["width"], info["height"]) == (item["width"], item["height"]) and info["source"]["sample"]
        if info["width"] * info["height"] <= 32 * 32:
            spec = client.post("/api/decompose", data={"token": info["token"], "method": "exact"}).get_json()
            assert spec["curves"]["energy"][-1] == pytest.approx(1.0)
        else:
            spec = client.post("/api/decompose", data={"token": info["token"], "method": "randomized", "rank": 8}).get_json()
            assert spec["max_rank"] == 8


def test_sample_routes_reject_traversal(client):
    assert client.get("/samples/../manifest.json").status_code == 404
    assert client.get("/samples/nope.png").status_code == 404
    assert client.post("/api/sample/..%2Fx").status_code == 404
