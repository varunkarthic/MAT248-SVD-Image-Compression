"""Flask web UI: upload an image, decompose it once, then explore any rank k."""

import argparse
import base64
import math
import secrets
import threading
from collections import OrderedDict

import numpy as np
from flask import Flask, abort, jsonify, render_template, request, send_from_directory

from . import lab, samples
from .compress import compress_blocks, decompose, rank_for_energy, result_for_rank
from .formats import PNG_SIGNATURE, decode_image, encode_png

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 4_000_000          # any method
MAX_EXACT_PIXELS = 512 * 512    # exact Jacobi is O(m n^2): about 30 s for 512 x 512 RGB
MAX_BLOCK_PIXELS = 1_500_000    # batched Jacobi on tiles: about 6 s per 0.4 MP RGB
DEFAULT_RANK_BUDGET = 150
RECON_CACHE_SIZE = 64           # cached rank-k payloads per uploaded image
SOURCE_FORMATS = {"png", "bmp", "pnm", "pgm", "ppm", "jpeg", "webp", "gif", "avif"}
NATIVE_FORMATS = {"png", "bmp", "pnm", "pgm", "ppm"}
CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
       "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")


class UnknownToken(Exception):
    """Raised when a request names an image that is not (or no longer) cached."""


class LRUCache:
    """Small thread-safe LRU of uploaded images and their factors."""

    # ponytail: in-process store, so it only works with a single worker. Use Redis or
    # similar if this is ever served by several processes.
    def __init__(self, size):
        self.size, self._data, self._lock = size, OrderedDict(), threading.Lock()

    def put(self, key, value):
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.size:
                self._data.popitem(last=False)

    def get(self, key):
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
            return self._data.get(key)


def _png_data_url(img):
    return "data:image/png;base64," + base64.b64encode(encode_png(img)).decode("ascii")


def _finite(x):
    return None if isinstance(x, float) and not math.isfinite(x) else x


def _detect_format(data):
    if data.startswith(PNG_SIGNATURE):
        return "png"
    if data[:2] == b"BM":
        return "bmp"
    return "pnm"


def _result_json(result):
    png = encode_png(result.image)
    payload = {
        "image": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
        "png_bytes": len(png),
        "stored_values": result.stored_values,
        "original_values": result.original_values,
        "ratio": result.ratio,
        "metrics": {key: _finite(val) for key, val in result.metrics.items()},
    }
    payload["metrics"]["frobenius_error"] = float(np.sqrt(result.metrics["mse"] * result.original_values))
    if np.isscalar(result.k):
        payload["k"] = int(result.k)
    else:
        payload["ranks"] = result.k.tolist()
    return payload


def _error(message, status=400):
    return jsonify({"error": message}), status


def _number(name, cast, default, low, high):
    raw = request.values.get(name)
    try:
        value = cast(raw) if raw not in (None, "") else default
    except ValueError:
        raise ValueError(f"{name} must be a number") from None
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


def create_app(cache_size=8):
    """Application factory."""
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
    cache = LRUCache(cache_size)
    app.config["SAMPLES"] = {item["id"]: item for item in samples.load_manifest()}

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if response.mimetype == "text/html":
            response.headers.setdefault("Content-Security-Policy", CSP)
        return response

    def register(img, source):
        """Cache a decoded image and describe it for the browser (never echoes the file name)."""
        h, w = img.shape[:2]
        token = secrets.token_urlsafe(16)
        cache.put(token, {"image": img, "factors": None, "method": None, "recon": OrderedDict(), "curves": None})
        return jsonify({"token": token, "width": w, "height": h, "original": _png_data_url(img),
                        "channels": 1 if img.ndim == 2 else img.shape[2], "source": source,
                        "exact_allowed": h * w <= MAX_EXACT_PIXELS,
                        "blocks_allowed": h * w <= MAX_BLOCK_PIXELS})

    def entry():
        found = cache.get(request.values.get("token", ""))
        if found is None:
            raise UnknownToken
        return found

    @app.errorhandler(ValueError)
    def bad_request(exc):
        return _error(str(exc))

    @app.errorhandler(UnknownToken)
    def unknown_token(_exc):
        return _error("unknown or expired image token; please upload again", 404)

    @app.errorhandler(413)
    def too_large(_exc):
        return _error(f"file too large (limit {MAX_UPLOAD_BYTES // 2**20} MB)", 413)

    @app.get("/")
    def index():
        return render_template("index.html", max_exact_pixels=MAX_EXACT_PIXELS,
                               max_block_pixels=MAX_BLOCK_PIXELS, default_rank=DEFAULT_RANK_BUDGET)

    @app.post("/api/upload")
    def upload():
        file = request.files.get("image")
        if file is None:
            return _error("no file uploaded (form field 'image')")
        data = file.read()
        if not data:
            return _error("the uploaded file is empty")
        img = decode_image(data, max_pixels=MAX_PIXELS)   # content decides the format, never the extension
        h, w = img.shape[:2]
        if h * w > MAX_PIXELS:
            return _error(f"image has {h * w:,} pixels; the limit is {MAX_PIXELS:,}")
        fmt = request.form.get("source_format", "").lower()
        converted = fmt in SOURCE_FORMATS and fmt not in NATIVE_FORMATS
        source = {"format": fmt if converted else _detect_format(data), "bytes": len(data),
                  "converted_in_browser": converted, "single_frame": fmt == "gif"}
        return register(img, source)

    @app.get("/api/samples")
    def sample_list():
        return jsonify({"samples": [{**item, "url": f"/samples/{item['file']}"}
                                    for item in app.config["SAMPLES"].values()]})

    @app.get("/samples/<name>")
    def sample_file(name):
        if name not in {item["file"] for item in app.config["SAMPLES"].values()}:
            abort(404)
        return send_from_directory(samples.SAMPLES, name, mimetype="image/png")

    @app.post("/api/sample/<sid>")
    def load_sample(sid):
        item = app.config["SAMPLES"].get(sid)
        if item is None:
            return _error("unknown sample image", 404)
        data = (samples.SAMPLES / item["file"]).read_bytes()
        return register(decode_image(data, max_pixels=MAX_PIXELS),
                        {"format": "png", "bytes": len(data), "converted_in_browser": False,
                         "single_frame": False, "sample": sid})

    @app.get("/api/worked-example")
    def worked_example_route():
        return jsonify(lab.worked_example())

    @app.post("/api/decompose")
    def decompose_route():
        item = entry()
        img = item["image"]
        h, w = img.shape[:2]
        method = request.values.get("method", "randomized")
        if method == "exact" and h * w > MAX_EXACT_PIXELS:
            return _error(f"exact SVD is limited to {MAX_EXACT_PIXELS:,} pixels; use randomized")
        rank = None
        if method == "randomized":
            rank = _number("rank", int, min(DEFAULT_RANK_BUDGET, h, w), 1, min(h, w))
        factors = decompose(img, method, rank=rank)
        item["factors"], item["method"], item["curves"] = factors, method, None
        item["recon"].clear()
        energy = np.cumsum((factors.s ** 2).sum(axis=0)) / (factors.energy_total or 1.0)
        return jsonify({
            "method": method,
            "max_rank": factors.max_rank,
            "sigma": [[float(f"{v:.5g}") for v in ch] for ch in factors.s],
            "energy": [round(float(v), 7) for v in energy],
            "suggested_k": min(rank_for_energy(factors.s, 0.9999, factors.energy_total), factors.max_rank),
            "curves": lab.spectral_curves(factors, method),
            "shape": list(factors.shape),
        })

    @app.get("/api/reconstruct")
    def reconstruct_route():
        item = entry()
        if item["factors"] is None:
            return _error("decompose the image first")
        k = _number("k", int, 1, 1, item["factors"].max_rank)
        recon = item["recon"]
        payload = recon.get(k)
        if payload is None:
            result = result_for_rank(item["image"], item["factors"], k)
            payload = _result_json(result)
            payload["spectral_error"] = lab.spectral_curves(item["factors"], item["method"])["spectral_error"][k - 1]
            payload["_image"] = result.image
            recon[k] = payload
            while len(recon) > RECON_CACHE_SIZE:
                recon.popitem(last=False)
        out = {key: val for key, val in payload.items() if key != "_image"}
        if request.values.get("diff") == "1":
            diff, top = lab.difference_image(item["image"], payload["_image"])
            out["difference"], out["difference_max"] = _png_data_url(diff), top
        return jsonify(out)

    @app.get("/api/component")
    def component_route():
        item = entry()
        if item["factors"] is None:
            return _error("decompose the image first")
        i = _number("i", int, 1, 1, item["factors"].max_rank)
        rgb, info = lab.component_image(item["factors"], i)
        return jsonify({**info, "image": _png_data_url(rgb)})

    @app.get("/api/curves")
    def curves_route():
        item = entry()
        if item["factors"] is None:
            return _error("decompose the image first")
        if item["curves"] is None:
            item["curves"] = lab.pixel_curves(item["image"], item["factors"], _number("points", int, 24, 4, 60))
        return jsonify({"points": item["curves"]})

    @app.post("/api/blocks")
    def blocks_route():
        img = entry()["image"]
        if img.shape[0] * img.shape[1] > MAX_BLOCK_PIXELS:
            return _error(f"adaptive blocks are limited to {MAX_BLOCK_PIXELS:,} pixels")
        block = _number("block", int, 32, 4, 256)
        energy = _number("energy", float, 0.95, 0.5, 1.0)
        return jsonify(_result_json(compress_blocks(img, block=block, energy=energy)))

    return app


def main(argv=None):
    parser = argparse.ArgumentParser(prog="svdcomp-web", description="Run the SVD compression web UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args(argv)
    create_app().run(host=args.host, port=args.port, debug=args.debug, threaded=True)


if __name__ == "__main__":
    main()
