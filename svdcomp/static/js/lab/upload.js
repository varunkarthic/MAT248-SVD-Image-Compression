/* Client-side file preparation: decide the format from the file CONTENT (never the extension),
 * pre-check the size, and convert browser-decodable formats to PNG before upload. */
import { bytes, int } from "../core.js";

/** Identify a file from its first bytes. Returns {kind, native, label}. */
export function sniff(head) {
  const at = (i) => head[i];
  const ascii = (s, o = 0) => [...s].every((c, i) => at(o + i) === c.charCodeAt(0));
  if (head.length >= 8 && at(0) === 0x89 && ascii("PNG", 1)) return { kind: "png", native: true, label: "PNG" };
  if (ascii("BM")) return { kind: "bmp", native: true, label: "BMP" };
  if (head.length >= 3 && at(0) === 0x50 && at(1) >= 0x31 && at(1) <= 0x36 && [0x0a, 0x0d, 0x20, 0x09].includes(at(2))) {
    return { kind: "pnm", native: true, label: at(1) === 0x35 || at(1) === 0x32 ? "PGM" : at(1) === 0x36 || at(1) === 0x33 ? "PPM" : "PNM" };
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { kind: "jpeg", native: false, label: "JPEG" };
  if (ascii("RIFF") && ascii("WEBP", 8)) return { kind: "webp", native: false, label: "WebP" };
  if (ascii("GIF8")) return { kind: "gif", native: false, label: "GIF" };
  if (ascii("ftyp", 4) && (ascii("avif", 8) || ascii("avis", 8))) return { kind: "avif", native: false, label: "AVIF" };
  return { kind: "other", native: false, label: "unknown format" };
}

function pngSize(head) {
  if (head.length < 24) return null;
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  return { w: v.getUint32(16), h: v.getUint32(20) };
}

const canvasToPng = (canvas) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The browser could not encode the image as PNG."))), "image/png"));

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** The canvas always writes RGBA PNGs. For fully opaque pictures write a plain gray or RGB PNG instead,
 *  so a JPEG is not decomposed as four channels. Returns null when the picture has real transparency
 *  or the browser cannot deflate (the caller then falls back to canvas.toBlob). */
async function encodeOpaquePng(ctx, w, h) {
  if (typeof CompressionStream !== "function") return null;
  const px = ctx.getImageData(0, 0, w, h).data;
  let gray = true;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] !== 255) return null;
    if (gray && (px[i] !== px[i + 1] || px[i] !== px[i + 2])) gray = false;
  }
  const ch = gray ? 1 : 3, row = w * ch + 1, raw = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) {
    let o = y * row + 1, i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) { raw[o++] = px[i]; if (!gray) { raw[o++] = px[i + 1]; raw[o++] = px[i + 2]; } }
  }
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w); hv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = gray ? 0 : 2;
  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  return { blob: new Blob([sig, chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))], { type: "image/png" }), gray };
}

/**
 * @returns {{blob, name, sourceFormat, notes:string[], inputLabel, fileSize}}
 * @throws Error with a user-friendly message.
 */
export async function prepareFile(file, { maxBytes, maxPixels }) {
  if (!file.size) throw new Error("That file is empty.");
  if (file.size > maxBytes) {
    throw new Error(`"${file.name}" is ${bytes(file.size)}; the limit is ${bytes(maxBytes)}. Choose a smaller file.`);
  }
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const kind = sniff(head);
  const base = { name: file.name, fileSize: file.size, inputLabel: kind.label, notes: [] };

  if (kind.native) {
    if (kind.kind === "png") {
      const size = pngSize(head);
      if (size && size.w * size.h > maxPixels) {
        throw new Error(`This image is ${int(size.w)} × ${int(size.h)} (${int(size.w * size.h)} pixels); the limit is ${int(maxPixels)} pixels. Shrink it first.`);
      }
    }
    return { ...base, blob: file, sourceFormat: "", };
  }

  // Browser-decodable formats: decode, optionally downscale, re-encode as PNG.
  if (typeof createImageBitmap !== "function") throw new Error("This browser cannot convert images. Please upload a PNG, BMP, PGM or PPM file.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(kind.kind === "other"
      ? `"${file.name}" is not an image this laboratory can read. Use PNG, JPEG, WebP, GIF, AVIF, BMP, PGM or PPM.`
      : `The browser could not decode this ${kind.label} file; it may be damaged.`);
  }
  try {
    let { width: w, height: h } = bitmap;
    const notes = [`converted from ${kind.label} to PNG in your browser before the SVD`];
    if (kind.kind === "gif") notes.push("only the first frame is used");
    if (w * h > maxPixels) {
      const s = Math.sqrt(maxPixels / (w * h)) * 0.999;
      const nw = Math.max(1, Math.floor(w * s)), nh = Math.max(1, Math.floor(h * s));
      notes.push(`downscaled from ${int(w)} × ${int(h)} to ${int(nw)} × ${int(nh)} (limit ${int(maxPixels)} pixels)`);
      w = nw; h = nh;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The browser could not create a drawing surface for the conversion.");
    ctx.drawImage(bitmap, 0, 0, w, h);
    let blob = null;
    try {
      const opaque = await encodeOpaquePng(ctx, w, h);
      if (opaque) { blob = opaque.blob; notes.push(opaque.gray ? "all pixels are gray, so it is processed as a 1-channel image" : "no transparency, so it is processed as a 3-channel RGB image"); }
    } catch { blob = null; }
    if (!blob) blob = await canvasToPng(canvas);
    if (blob.size > maxBytes) throw new Error(`After conversion the PNG is ${bytes(blob.size)}, above the ${bytes(maxBytes)} limit. Use a smaller image.`);
    const known = ["jpeg", "webp", "gif", "avif"].includes(kind.kind);
    return { ...base, blob, notes, sourceFormat: known ? kind.kind : "" };
  } finally {
    bitmap.close?.();
  }
}
