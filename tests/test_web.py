import base64
import io

import numpy as np
import pytest

from svdcomp import web
from svdcomp.formats import decode_png, encode_bmp, encode_png

rng = np.random.default_rng(3)
IMG = rng.integers(0, 256, (24, 32, 3), dtype=np.uint8)


@pytest.fixture
def client():
    return web.create_app(cache_size=2).test_client()


def upload(client, data=None, name="x.png"):
    data = encode_png(IMG) if data is None else data
    return client.post("/api/upload", data={"image": (io.BytesIO(data), name)}, content_type="multipart/form-data")


def decode_data_url(url):
    return decode_png(base64.b64decode(url.split(",", 1)[1]))


def test_index(client):
    res = client.get("/")
    assert res.status_code == 200 and b"SVD Image Compression" in res.data


def test_full_global_flow(client):
    info = upload(client).get_json()
    assert (info["width"], info["height"], info["channels"]) == (32, 24, 3)
    np.testing.assert_array_equal(decode_data_url(info["original"]), IMG)
    spec = client.post("/api/decompose", data={"token": info["token"], "method": "exact"}).get_json()
    assert spec["max_rank"] == 24 and len(spec["sigma"]) == 3 and len(spec["energy"]) == 24
    assert spec["energy"][-1] == pytest.approx(1.0)
    res = client.get(f"/api/reconstruct?token={info['token']}&k=24").get_json()
    np.testing.assert_array_equal(decode_data_url(res["image"]), IMG)
    assert res["metrics"]["psnr"] is None  # lossless -> infinite PSNR serialised as null
    res = client.get(f"/api/reconstruct?token={info['token']}&k=3").get_json()
    assert res["k"] == 3 and res["stored_values"] == 3 * 3 * (24 + 32 + 1)


def test_randomized_and_blocks(client):
    token = upload(client, encode_bmp(IMG), "x.bmp").get_json()["token"]
    spec = client.post("/api/decompose", data={"token": token, "method": "randomized", "rank": "5"}).get_json()
    assert spec["max_rank"] == 5
    res = client.post("/api/blocks", data={"token": token, "block": "8", "energy": "0.9"}).get_json()
    assert np.array(res["ranks"]).shape == (3, 4)


@pytest.mark.parametrize("path,data,status", [
    ("/api/decompose", {"token": "nope"}, 404),
    ("/api/blocks", {"token": "nope"}, 404),
])
def test_unknown_token(client, path, data, status):
    assert client.post(path, data=data).status_code == status


def test_validation_errors(client):
    assert client.post("/api/upload").status_code == 400
    bad = upload(client, b"GIF89a-not-supported", "x.gif")
    assert bad.status_code == 400 and "unsupported" in bad.get_json()["error"]
    token = upload(client).get_json()["token"]
    assert client.get(f"/api/reconstruct?token={token}&k=2").status_code == 400  # not decomposed yet
    client.post("/api/decompose", data={"token": token, "method": "exact"})
    assert client.get(f"/api/reconstruct?token={token}&k=999").status_code == 400
    assert client.get(f"/api/reconstruct?token={token}&k=abc").status_code == 400
    assert client.post("/api/decompose", data={"token": token, "method": "magic"}).status_code == 400
    assert client.post("/api/blocks", data={"token": token, "energy": "2"}).status_code == 400


def test_size_limits(client, monkeypatch):
    monkeypatch.setattr(web, "MAX_EXACT_PIXELS", 100)
    token = upload(client).get_json()["token"]
    res = client.post("/api/decompose", data={"token": token, "method": "exact"})
    assert res.status_code == 400 and "randomized" in res.get_json()["error"]
    monkeypatch.setattr(web, "MAX_PIXELS", 100)
    assert upload(client).status_code == 400


def test_cache_evicts_oldest(client):
    first = upload(client).get_json()["token"]
    upload(client)
    upload(client)
    assert client.post("/api/decompose", data={"token": first}).status_code == 404
