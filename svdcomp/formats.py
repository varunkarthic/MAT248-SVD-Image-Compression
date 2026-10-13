"""From-scratch image codecs: PNG, BMP and PNM (PGM/PPM).

Every decoder returns a ``uint8`` array of shape ``(H, W)`` for grayscale or
``(H, W, C)`` with ``C`` in 2 (gray + alpha), 3 (RGB) or 4 (RGBA). DEFLATE
(de)compression uses the standard library's :mod:`zlib`. Chunk parsing, CRC
checks, scanline filtering, palettes and bit unpacking are implemented here.
"""

import re
import struct
import zlib
from pathlib import Path

import numpy as np

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
_PNG_DEPTHS = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}


def as_uint8_image(img):
    """Validate an image array and convert it to ``uint8`` (rounding and clipping floats)."""
    img = np.asarray(img)
    if img.ndim == 3 and img.shape[2] == 1:
        img = img[:, :, 0]
    if img.ndim not in (2, 3) or (img.ndim == 3 and img.shape[2] not in (2, 3, 4)):
        raise ValueError(f"expected an (H, W) or (H, W, 2|3|4) image, got shape {img.shape}")
    if img.shape[0] == 0 or img.shape[1] == 0:
        raise ValueError("image has no pixels")
    if img.dtype != np.uint8:
        img = np.clip(np.rint(img), 0, 255).astype(np.uint8)
    return img


def _scale_to_uint8(values, maxval):
    if maxval == 255:
        return values.astype(np.uint8)
    return np.rint(values.astype(float) * (255.0 / maxval)).astype(np.uint8)


def _unpack_bits(rows, depth, count):
    """Split each byte of ``rows`` into ``8 / depth`` big-endian samples; keep ``count`` per row."""
    bits = np.unpackbits(rows, axis=1).reshape(rows.shape[0], -1, depth)
    weights = 1 << np.arange(depth - 1, -1, -1)
    return (bits * weights).sum(axis=2)[:, :count]


# --------------------------------------------------------------------------- PNG

def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def _unfilter(raw, height, stride, bpp):
    """Undo the five PNG scanline filters. ``raw`` holds ``height * (1 + stride)`` bytes."""
    out = np.empty((height, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.uint8)
    for y in range(height):
        start = y * (stride + 1)
        ftype = raw[start]
        line = np.frombuffer(raw, dtype=np.uint8, count=stride, offset=start + 1)
        if ftype == 0:  # None
            cur = line.copy()
        elif ftype == 1:  # Sub: running sum per byte lane, mod 256
            cur = np.cumsum(line.reshape(-1, bpp), axis=0, dtype=np.uint8).ravel()
        elif ftype == 2:  # Up
            cur = line + prev
        elif ftype in (3, 4):  # Average / Paeth depend on the byte just decoded
            cur = bytearray(line.tobytes())
            up = prev.tolist()
            for i in range(stride):
                a = cur[i - bpp] if i >= bpp else 0
                if ftype == 3:
                    pred = (a + up[i]) >> 1
                else:
                    pred = _paeth(a, up[i], up[i - bpp] if i >= bpp else 0)
                cur[i] = (cur[i] + pred) & 0xFF
            cur = np.frombuffer(bytes(cur), dtype=np.uint8)
        else:
            raise ValueError(f"PNG: invalid filter type {ftype} on row {y}")
        out[y] = cur
        prev = out[y]
    return out


def decode_png(data):
    """Decode a non-interlaced PNG (all colour types, bit depths 1-16)."""
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")
    pos, header, palette, trns, idat = 8, None, None, None, []
    while True:
        if pos + 12 > len(data):
            raise ValueError("PNG: truncated file (missing IEND)")
        length, ctype = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        crc = data[pos + 8 + length:pos + 12 + length]
        if len(body) != length or len(crc) != 4:
            raise ValueError("PNG: truncated chunk")
        if zlib.crc32(ctype + body) != struct.unpack(">I", crc)[0]:
            raise ValueError(f"PNG: CRC mismatch in {ctype.decode('latin-1')} chunk")
        pos += 12 + length
        if ctype == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif ctype == b"PLTE":
            palette = np.frombuffer(body, dtype=np.uint8).reshape(-1, 3)
        elif ctype == b"tRNS":
            trns = body
        elif ctype == b"IDAT":
            idat.append(body)
        elif ctype == b"IEND":
            break
        elif not ctype[0] & 0x20:  # upper-case first letter = critical chunk
            raise ValueError(f"PNG: unsupported critical chunk {ctype.decode('latin-1')}")

    if header is None:
        raise ValueError("PNG: missing IHDR")
    width, height, depth, color, compression, filtering, interlace = header
    if color not in _PNG_CHANNELS or depth not in _PNG_DEPTHS[color]:
        raise ValueError(f"PNG: invalid colour type {color} / bit depth {depth}")
    if compression or filtering:
        raise ValueError("PNG: unknown compression or filter method")
    if interlace:
        raise ValueError("PNG: interlaced (Adam7) images are not supported")
    if width == 0 or height == 0:
        raise ValueError("PNG: zero-sized image")
    if color == 3 and palette is None:
        raise ValueError("PNG: palette image without PLTE chunk")

    channels = _PNG_CHANNELS[color]
    bits_per_pixel = channels * depth
    stride = (width * bits_per_pixel + 7) // 8
    try:
        raw = zlib.decompress(b"".join(idat))
    except zlib.error as exc:
        raise ValueError(f"PNG: corrupt image data ({exc})") from None
    if len(raw) < height * (stride + 1):
        raise ValueError("PNG: image data too short")
    rows = _unfilter(raw, height, stride, max(1, bits_per_pixel // 8))

    if depth == 16:
        pairs = rows.reshape(height, width * channels, 2).astype(np.uint16)
        pixels = _scale_to_uint8(pairs[..., 0] * 256 + pairs[..., 1], 65535)
    elif depth == 8:
        pixels = rows
    else:
        pixels = _unpack_bits(rows, depth, width)
        if color == 0:
            pixels = _scale_to_uint8(pixels, (1 << depth) - 1)
    pixels = pixels.reshape(height, width, channels)

    if color == 3:
        index = pixels[:, :, 0].astype(np.intp)
        if index.max() >= len(palette):
            raise ValueError("PNG: palette index out of range")
        rgb = palette[index]
        if trns is None:
            return rgb
        alpha = np.full(len(palette), 255, dtype=np.uint8)
        alpha[:len(trns)] = np.frombuffer(trns[:len(palette)], dtype=np.uint8)
        return np.dstack([rgb, alpha[index]])
    return pixels[:, :, 0] if channels == 1 else pixels.astype(np.uint8)


def _png_chunk(ctype, body):
    return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", zlib.crc32(ctype + body))


def encode_png(img, level=6):
    """Encode an 8-bit Gray / Gray+Alpha / RGB / RGBA image as PNG bytes.

    Every scanline uses the *Up* filter (row minus the row above, mod 256).
    It is cheap to compute and works well on the smooth images that rank-k
    reconstructions produce.
    """
    img = as_uint8_image(img)
    height, width = img.shape[:2]
    channels = 1 if img.ndim == 2 else img.shape[2]
    rows = img.reshape(height, width * channels)
    up = rows - np.vstack([np.zeros((1, rows.shape[1]), np.uint8), rows[:-1]])  # uint8 wraps mod 256
    payload = np.hstack([np.full((height, 1), 2, np.uint8), up]).tobytes()
    color = {1: 0, 2: 4, 3: 2, 4: 6}[channels]
    ihdr = struct.pack(">IIBBBBB", width, height, 8, color, 0, 0, 0)
    return (PNG_SIGNATURE + _png_chunk(b"IHDR", ihdr)
            + _png_chunk(b"IDAT", zlib.compress(payload, level)) + _png_chunk(b"IEND", b""))


# --------------------------------------------------------------------------- BMP

def decode_bmp(data):
    """Decode an uncompressed BMP (1/4/8-bit palette, 24-bit, 32-bit incl. bit fields)."""
    if data[:2] != b"BM" or len(data) < 26:
        raise ValueError("not a BMP file")
    offset, header_size = struct.unpack_from("<I", data, 10)[0], struct.unpack_from("<I", data, 14)[0]
    if header_size == 12:  # OS/2 BITMAPCOREHEADER
        width, height, _, bpp = struct.unpack_from("<HHHH", data, 18)
        compression, colors_used, entry = 0, 0, 3
    elif header_size >= 40:
        width, height, _, bpp, compression = struct.unpack_from("<iiHHI", data, 18)
        colors_used, entry = struct.unpack_from("<I", data, 46)[0], 4
    else:
        raise ValueError(f"BMP: unknown header size {header_size}")
    top_down = height < 0
    height = abs(height)
    if width <= 0 or height == 0:
        raise ValueError("BMP: invalid dimensions")
    if bpp not in (1, 4, 8, 24, 32) or compression not in (0, 3) or (compression == 3 and bpp != 32):
        raise ValueError(f"BMP: unsupported format ({bpp}-bit, compression {compression})")

    row_size = (bpp * width + 31) // 32 * 4
    if offset + row_size * height > len(data):
        raise ValueError("BMP: pixel data truncated")
    rows = np.frombuffer(data, dtype=np.uint8, count=row_size * height, offset=offset).reshape(height, row_size)
    if not top_down:
        rows = rows[::-1]

    if bpp == 24:
        return rows[:, :width * 3].reshape(height, width, 3)[:, :, ::-1].copy()
    if bpp == 32:
        px = rows[:, :width * 4].reshape(height, width, 4)
        if compression == 0:  # BGRX; the fourth byte is unused
            return px[:, :, 2::-1].copy()
        mask_at = 54  # right after a 40-byte header, or inside a V4/V5 header
        masks = list(struct.unpack_from("<III", data, mask_at))
        if header_size >= 56:
            masks.append(struct.unpack_from("<I", data, mask_at + 12)[0])
        words = px.copy().view("<u4")[:, :, 0].astype(np.uint64)
        planes = []
        for mask in masks:
            if mask == 0:
                continue
            shift = (mask & -mask).bit_length() - 1
            maxval = mask >> shift
            planes.append(_scale_to_uint8((words & mask) >> shift, maxval))
        return np.dstack(planes)

    count = colors_used or (1 << bpp)
    table_at = 14 + header_size
    palette = np.frombuffer(data, dtype=np.uint8, count=count * entry, offset=table_at).reshape(count, entry)
    palette = palette[:, 2::-1]  # BGR(A) -> RGB
    index = rows[:, :width] if bpp == 8 else _unpack_bits(rows, bpp, width)
    if index.max() >= count:
        raise ValueError("BMP: palette index out of range")
    rgb = palette[index]
    if np.all(palette[:, 0] == palette[:, 1]) and np.all(palette[:, 1] == palette[:, 2]):
        return rgb[:, :, 0].copy()
    return rgb


def encode_bmp(img):
    """Encode as BMP: grayscale -> 8-bit with a gray palette, RGB -> 24-bit."""
    img = as_uint8_image(img)
    if img.ndim == 3 and img.shape[2] in (2, 4):
        raise ValueError("BMP output does not support an alpha channel; use PNG")
    height, width = img.shape[:2]
    if img.ndim == 2:
        bpp, pixels = 8, img
        palette = np.repeat(np.arange(256, dtype=np.uint8)[:, None], 4, axis=1)
        palette[:, 3] = 0
        table = palette.tobytes()
    else:
        bpp, pixels, table = 24, img[:, :, ::-1].reshape(height, width * 3), b""
    row_size = (bpp * width + 31) // 32 * 4
    body = np.zeros((height, row_size), dtype=np.uint8)
    body[:, :pixels.shape[1]] = pixels
    body = body[::-1].tobytes()  # bottom-up
    offset = 14 + 40 + len(table)
    file_header = b"BM" + struct.pack("<IHHI", offset + len(body), 0, 0, offset)
    info = struct.pack("<IiiHHIIiiII", 40, width, height, 1, bpp, 0, len(body), 2835, 2835,
                       256 if bpp == 8 else 0, 0)
    return file_header + info + table + body


# --------------------------------------------------------------------------- PNM

_PNM_TOKEN = re.compile(rb"\s*(?:#[^\n]*\n\s*)*(\S+)")


def decode_pnm(data):
    """Decode PGM/PPM: ASCII (P2, P3) or binary (P5, P6), maxval up to 65535."""
    magic = data[:2]
    if magic not in (b"P2", b"P3", b"P5", b"P6"):
        raise ValueError("not a PGM/PPM file")
    pos, header = 2, []
    for _ in range(3):
        match = _PNM_TOKEN.match(data, pos)
        if not match:
            raise ValueError("PNM: truncated header")
        header.append(int(match.group(1)))
        pos = match.end()
    width, height, maxval = header
    if width <= 0 or height <= 0 or not 0 < maxval < 65536:
        raise ValueError("PNM: invalid header values")
    channels = 3 if magic in (b"P3", b"P6") else 1
    count = width * height * channels
    if magic in (b"P5", b"P6"):
        dtype = np.uint8 if maxval < 256 else np.dtype(">u2")
        raster = data[pos + 1:]  # exactly one whitespace byte follows maxval
        if len(raster) < count * np.dtype(dtype).itemsize:
            raise ValueError("PNM: pixel data truncated")
        values = np.frombuffer(raster, dtype=dtype, count=count)
    else:
        tokens = re.sub(rb"#[^\n]*", b"", data[pos:]).split()
        if len(tokens) < count:
            raise ValueError("PNM: pixel data truncated")
        values = np.array(tokens[:count], dtype=np.int64)
    if values.max() > maxval:
        raise ValueError("PNM: sample exceeds maxval")
    pixels = _scale_to_uint8(values, maxval).reshape(height, width, channels)
    return pixels[:, :, 0] if channels == 1 else pixels


def encode_pnm(img):
    """Encode as binary PGM (P5) for grayscale or PPM (P6) for RGB."""
    img = as_uint8_image(img)
    if img.ndim == 3 and img.shape[2] != 3:
        raise ValueError("PNM output supports grayscale or RGB only; use PNG")
    magic = b"P5" if img.ndim == 2 else b"P6"
    return magic + f"\n{img.shape[1]} {img.shape[0]}\n255\n".encode() + img.tobytes()


# --------------------------------------------------------------------------- dispatch

def decode_image(data):
    """Decode image bytes, detecting the format from its magic number."""
    data = bytes(data)
    if data.startswith(PNG_SIGNATURE):
        return decode_png(data)
    if data[:2] == b"BM":
        return decode_bmp(data)
    if data[:2] in (b"P2", b"P3", b"P5", b"P6"):
        return decode_pnm(data)
    raise ValueError("unsupported image format (supported: PNG, BMP, PGM/PPM)")


def read_image(path):
    """Read an image file into a ``uint8`` array."""
    return decode_image(Path(path).read_bytes())


_ENCODERS = {".png": encode_png, ".bmp": encode_bmp, ".pgm": encode_pnm, ".ppm": encode_pnm, ".pnm": encode_pnm}


def write_image(path, img):
    """Write an image; the format is chosen from the file extension."""
    path = Path(path)
    encoder = _ENCODERS.get(path.suffix.lower())
    if encoder is None:
        raise ValueError(f"unsupported output extension {path.suffix!r} (use .png, .bmp, .pgm, .ppm)")
    path.write_bytes(encoder(img))
