/* "Processing" animation, played while an image is loaded: pixels become a matrix, the matrix factors into
 * U, Sigma, V^T, the singular values line up, and a small picture is rebuilt through pre-baked rank-k
 * steps. Deterministic illustration, not the user's image. No SVD code runs in the browser. */
import { lerp, seg } from "./player.js";
import { FACE_RANKS, FACE_SIGMA, faceRank } from "./faceData.js";

const W = 640, H = 360;
export const PROCESSING_DURATION = 3.5;
const BG = "#15171c", PAPER = "#f7f3ea", COBALT = "#8fb0ee", VERMILION = "#e0583e";

// ---------- deterministic scene data ----------
function rng(seed) { // mulberry32
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(248);
const DUST = Array.from({ length: 220 }, () => ({ x: rand() * W, y: rand() * H, g: 90 + rand() * 120, s: 1.5 + rand() * 1.5, ph: rand() * 6.28 }));
const rankMemo = {};
const rankOf = (k) => (rankMemo[k] ||= faceRank(k));
const FACE16 = rankOf(16);
const GRID = 6, CELL = 34, GAP = 4, GCX = 320, GCY = 178;
// A 6x6 patch of the face picture (rows 3-8, cols 3-8) is the "matrix".
const CELLS = [];
for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
  CELLS.push({ i, j, v: FACE16[(3 + i) * 16 + 3 + j], sx: rand() * W, sy: rand() * H,
               u: 0.15 + 0.8 * rand(), w: 0.15 + 0.8 * rand() });
}
const SIG = FACE_SIGMA.filter((s) => s > 1).slice(0, 6);
const SMAX = SIG[0];
const BLOCKS = [{ id: "U", cx: 112 }, { id: "S", cx: 320 }, { id: "V", cx: 528 }];

const gray = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

function label(ctx, x, y, main, sup, size, color, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = color; ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${size}px "Iowan Old Style", Palatino, Georgia, serif`;
  const w = ctx.measureText(main).width;
  let sw = 0;
  if (sup) { ctx.font = `600 ${size * 0.6}px "Iowan Old Style", Palatino, Georgia, serif`; sw = ctx.measureText(sup).width; }
  const x0 = x - (w + sw) / 2;
  ctx.font = `600 ${size}px "Iowan Old Style", Palatino, Georgia, serif`;
  ctx.fillText(main, x0, y);
  if (sup) { ctx.font = `600 ${size * 0.6}px "Iowan Old Style", Palatino, Georgia, serif`; ctx.fillText(sup, x0 + w + 1, y - size * 0.4); }
  ctx.restore();
}
function caption(ctx, text, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = "#d8d3c6"; ctx.textAlign = "center";
  ctx.font = '500 15px "Cascadia Mono", Consolas, Menlo, monospace';
  ctx.fillText(text, W / 2, 44); ctx.restore();
}

/** Pixel values of the face after k components, cross-faded through the pre-baked ranks. */
function facePixels(p) { // p in [0, 1] across FACE_RANKS
  const x = p * (FACE_RANKS.length - 1), a = Math.min(FACE_RANKS.length - 2, Math.floor(x)), f = x - a;
  const A = rankOf(FACE_RANKS[a]), B = rankOf(FACE_RANKS[a + 1]);
  return { px: A.map((v, i) => lerp(v, B[i], f)), k: FACE_RANKS[f > 0.5 ? a + 1 : a] };
}

function drawBlock(ctx, kind, cx, cy, cell, a) {
  const gap = 2, span = GRID * (cell + gap) - gap, x0 = cx - span / 2, y0 = cy - span / 2;
  ctx.save(); ctx.globalAlpha = a;
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const x = x0 + j * (cell + gap), y = y0 + i * (cell + gap);
    if (kind === "S") {
      if (i === j) { const s = SIG[i] / SMAX; ctx.fillStyle = `rgba(143,176,238,${0.35 + 0.65 * Math.sqrt(s)})`; ctx.fillRect(x, y, cell, cell); }
      else { ctx.fillStyle = "#23262d"; ctx.fillRect(x, y, cell, cell); }
    } else {
      const c = CELLS[i * GRID + j], t = kind === "U" ? c.u : c.w, g = 60 + 150 * t;
      ctx.fillStyle = gray(g); ctx.fillRect(x, y, cell, cell);
    }
  }
  ctx.restore();
}

export function drawProcessing(ctx, t) {
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const field = seg(t, 0, 0.35), toGrid = seg(t, 0.45, 0.95), split = seg(t, 0.95, 1.45);
  const bars = seg(t, 1.55, 2.0), face = seg(t, 2.15, 2.9);

  // dust: the first "field of pixels"
  const dustA = field * (1 - seg(t, 0.4, 0.95)) * 0.9;
  if (dustA > 0.01) {
    for (const d of DUST) {
      ctx.fillStyle = gray(d.g, dustA);
      ctx.fillRect(d.x + Math.sin(t * 2 + d.ph) * 2, d.y + Math.cos(t * 1.7 + d.ph) * 2, d.s, d.s);
    }
  }

  // matrix cells: appear as tiny pixels, organise into a grid, then split
  const aliveA = field * (1 - seg(t, 0.95, 1.25));
  if (aliveA > 0.01) {
    const s = lerp(5, CELL, toGrid);
    const k = lerp(1, 0.85, split);
    for (const c of CELLS) {
      const tx = GCX + (c.j - (GRID - 1) / 2) * (CELL + GAP) * k, ty = GCY + (c.i - (GRID - 1) / 2) * (CELL + GAP) * k;
      const x = lerp(c.sx, tx, toGrid), y = lerp(c.sy, ty, toGrid), sz = s * k;
      ctx.fillStyle = gray(70 + 0.65 * c.v, aliveA); // lifted so dark pixels stay visible on the dark stage
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
  }
  if (toGrid > 0.9 && t < 1.5) { // brackets of the matrix + name
    const w = GRID * (CELL + GAP) / 2 + 10, a = seg(t, 0.8, 1.0) * (1 - seg(t, 1.05, 1.3));
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = PAPER; ctx.lineWidth = 2;
    for (const sgn of [-1, 1]) { const x = GCX + sgn * w; ctx.beginPath(); ctx.moveTo(x - sgn * 8, GCY - w + 6); ctx.lineTo(x, GCY - w + 6); ctx.lineTo(x, GCY + w - 6); ctx.lineTo(x - sgn * 8, GCY + w - 6); ctx.stroke(); }
    ctx.restore();
    label(ctx, GCX, GCY + w + 28, "A", "", 26, PAPER, a);
  }

  // three blocks U, Sigma, V^T
  const blockA = split * (1 - seg(t, 1.55, 1.85));
  if (blockA > 0.01) {
    const cell = lerp(30, 17, split);
    for (const b of BLOCKS) {
      const cx = lerp(GCX, b.cx, split), cy = 172;
      drawBlock(ctx, b.id, cx, cy, cell, blockA);
      const sup = b.id === "V" ? "T" : "";
      label(ctx, cx, 262, b.id === "S" ? "Σ" : b.id, sup, 30, b.id === "S" ? COBALT : PAPER, blockA * seg(t, 1.2, 1.45));
    }
    const sym = seg(t, 1.3, 1.55) * (1 - seg(t, 1.55, 1.85));
    label(ctx, 216, 183, "×", "", 30, "#d8d3c6", sym);
    label(ctx, 424, 183, "×", "", 30, "#d8d3c6", sym);
    label(ctx, W / 2, 98, "A = U Σ V", "T", 26, PAPER, sym);
  }

  // singular values, largest first
  const baseY = lerp(280, 336, seg(t, 2.1, 2.45)), scale = lerp(1, 0.3, seg(t, 2.1, 2.45));
  const barA = bars * (face > 0 ? lerp(1, 0.9, face) : 1);
  const fp = facePixels(face);
  if (barA > 0.01) {
    const bw = 40, gp = 16, x0 = W / 2 - (SIG.length * (bw + gp) - gp) / 2;
    SIG.forEach((s, i) => {
      const grow = seg(t, 1.55 + i * 0.05, 1.95 + i * 0.05);
      const h = (s / SMAX) * 150 * grow * scale, x = x0 + i * (bw + gp);
      const used = face > 0 && i < fp.k;
      ctx.fillStyle = used ? VERMILION : COBALT;
      ctx.globalAlpha = barA * (face > 0 ? (used ? 1 : 0.45) : 1);
      ctx.fillRect(x, baseY - h, bw, h);
      ctx.globalAlpha = barA * 0.9;
      if (face <= 0.01) label(ctx, x + bw / 2, baseY + 22, "σ", String(i + 1), 18, "#d8d3c6", barA);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#d8d3c6"; ctx.globalAlpha = barA * 0.5; ctx.fillRect(x0 - 8, baseY, SIG.length * (bw + gp) - gp + 16, 1); ctx.globalAlpha = 1;
  }

  // the rebuilt picture, from the pre-baked rank-1..16 reconstructions
  if (face > 0.01) {
    const cs = 11, x0 = W / 2 - 8 * cs, y0 = 78;
    ctx.globalAlpha = Math.min(1, face * 3);
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
      ctx.fillStyle = gray(Math.max(0, Math.min(255, fp.px[r * 16 + c])));
      ctx.fillRect(x0 + c * cs, y0 + r * cs, cs, cs);
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.fillStyle = "#d8d3c6"; ctx.textAlign = "center"; ctx.font = '500 14px "Cascadia Mono", Consolas, Menlo, monospace';
    ctx.fillText(`rank k = ${fp.k}`, W / 2, y0 + 16 * cs + 24); ctx.restore();
  }

  // scene caption
  const cap = t < 0.45 ? "Pixels" : t < 0.95 ? "become a matrix" : t < 1.55 ? "which factors" : t < 2.15 ? "singular values, largest first" : t < 2.9 ? "and rebuild the picture" : "";
  if (cap) caption(ctx, cap, 0.85);

  // closing veil: the title card is DOM text above the canvas
  const veil = seg(t, 2.9, 3.3) * 0.88;
  if (veil > 0) { ctx.fillStyle = `rgba(21,23,28,${veil})`; ctx.fillRect(0, 0, W, H); }
}

