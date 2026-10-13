import struct
import zlib

import numpy as np
import pytest

from svdcomp.formats import (PNG_SIGNATURE, _paeth, _png_chunk, decode_image, decode_png,
                             encode_bmp, encode_png, encode_pnm, read_image, write_image)

rng = np.random.default_rng(42)
GRAY = rng.integers(0, 256, (13, 17), dtype=np.uint8)
RGB = rng.integers(0, 256, (11, 9, 3), dtype=np.uint8)


def filter_rows(rows, ftype, bpp):
    """Reference forward PNG filter, straight from the specification."""
    out, prev = [], [0] * len(rows[0])
    for row in rows:
        row = [int(v) for v in row]
        line = [ftype]
        for i, x in enumerate(row):
            a = row[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            pred = [0, a, b, (a + b) // 2, _paeth(a, b, c)][ftype]
            line.append((x - pred) % 256)
        out.append(bytes(line))
        prev = row
    return b"".join(out)


def make_png(rows, width, height, depth, color, extra=b"", ftype=0, bpp=1):
    ihdr = struct.pack(">IIBBBBB", width, height, depth, color, 0, 0, 0)
    idat = zlib.compress(filter_rows(rows, ftype, bpp))
    return PNG_SIGNATURE + _png_chunk(b"IHDR", ihdr) + extra + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b"")


@pytest.mark.parametrize("channels", [1, 2, 3, 4])
def test_png_roundtrip(channels):
    img = rng.integers(0, 256, (10, 7, channels), dtype=np.uint8)
    out = decode_png(encode_png(img))
    np.testing.assert_array_equal(out, img[:, :, 0] if channels == 1 else img)


@pytest.mark.parametrize("ftype", [0, 1, 2, 3, 4])
def test_png_every_filter_type(ftype):
    data = make_png(RGB.reshape(11, -1), 9, 11, 8, 2, ftype=ftype, bpp=3)
    np.testing.assert_array_equal(decode_png(data), RGB)


def test_png_16bit():
    img16 = rng.integers(0, 65536, (5, 4), dtype=np.uint16)
    rows = img16.astype(">u2").view(np.uint8).reshape(5, 8)
    out = decode_png(make_png(rows, 4, 5, 16, 0, ftype=4, bpp=2))
    np.testing.assert_array_equal(out, np.rint(img16 / 65535 * 255).astype(np.uint8))


@pytest.mark.parametrize("depth", [1, 2, 4])
def test_png_low_bit_depth_gray(depth):
    vals = rng.integers(0, 1 << depth, (6, 11))
    per_byte = 8 // depth
    padded = np.zeros((6, -(-11 // per_byte) * per_byte), dtype=np.int64)
    padded[:, :11] = vals
    groups = padded.reshape(6, -1, per_byte)
    shifts = depth * np.arange(per_byte - 1, -1, -1)
    rows = (groups << shifts).sum(axis=2).astype(np.uint8)
    out = decode_png(make_png(rows, 11, 6, depth, 0))
    np.testing.assert_array_equal(out, np.rint(vals * 255 / ((1 << depth) - 1)))


def test_png_palette_with_transparency():
    palette = np.array([[255, 0, 0], [0, 255, 0], [0, 0, 255]], dtype=np.uint8)
    index = rng.integers(0, 3, (4, 5), dtype=np.uint8)
    extra = _png_chunk(b"PLTE", palette.tobytes()) + _png_chunk(b"tRNS", bytes([0, 128]))
    out = decode_png(make_png(index, 5, 4, 8, 3, extra=extra))
    np.testing.assert_array_equal(out[:, :, :3], palette[index])
    np.testing.assert_array_equal(out[:, :, 3], np.array([0, 128, 255])[index])


def test_png_rejects_corruption_and_interlace():
    data = bytearray(encode_png(GRAY))
    data[30] ^= 0xFF  # inside IHDR body -> CRC mismatch
    with pytest.raises(ValueError, match="CRC"):
        decode_png(bytes(data))
    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 0, 0, 0, 1)
    interlaced = PNG_SIGNATURE + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IEND", b"")
    with pytest.raises(ValueError, match="interlaced"):
        decode_png(interlaced)
    with pytest.raises(ValueError):
        decode_png(encode_png(GRAY)[:40])


@pytest.mark.parametrize("img", [GRAY, RGB, GRAY[:, :3], RGB[:, :1]])
def test_bmp_roundtrip(img):
    np.testing.assert_array_equal(decode_image(encode_bmp(img)), img)


def test_bmp_32bit_bitfields_top_down():
    rgba = rng.integers(0, 256, (3, 2, 4), dtype=np.uint8)
    bgra = rgba[:, :, [2, 1, 0, 3]].tobytes()
    info = struct.pack("<IiiHHIIiiII", 56, 2, -3, 1, 32, 3, len(bgra), 0, 0, 0, 0)
    info += struct.pack("<IIII", 0x00FF0000, 0x0000FF00, 0x000000FF, 0xFF000000)
    offset = 14 + len(info)
    data = b"BM" + struct.pack("<IHHI", offset + len(bgra), 0, 0, offset) + info + bgra
    np.testing.assert_array_equal(decode_image(data), rgba)


def test_bmp_rejects_alpha():
    with pytest.raises(ValueError):
        encode_bmp(np.zeros((2, 2, 4), np.uint8))


@pytest.mark.parametrize("img", [GRAY, RGB])
def test_pnm_binary_roundtrip(img):
    np.testing.assert_array_equal(decode_image(encode_pnm(img)), img)


def test_pnm_ascii_with_comments_and_maxval():
    data = b"P2\n# a comment\n3 2\n# another\n15\n0 15 3\n# mid\n6 9 12\n"
    expected = np.rint(np.array([[0, 15, 3], [6, 9, 12]]) * 255 / 15)
    np.testing.assert_array_equal(decode_image(data), expected)
    ppm = b"P3 1 1 255 10 20 30"
    np.testing.assert_array_equal(decode_image(ppm), [[[10, 20, 30]]])


def test_dispatch_and_files(tmp_path):
    with pytest.raises(ValueError, match="unsupported"):
        decode_image(b"GIF89a....")
    for ext in (".png", ".bmp", ".ppm"):
        write_image(tmp_path / f"x{ext}", RGB)
        np.testing.assert_array_equal(read_image(tmp_path / f"x{ext}"), RGB)
    with pytest.raises(ValueError):
        write_image(tmp_path / "x.jpg", RGB)


def test_float_input_is_rounded_and_clipped():
    out = decode_png(encode_png(np.array([[-3.0, 12.4], [12.6, 300.0]])))
    np.testing.assert_array_equal(out, [[0, 12], [13, 255]])
