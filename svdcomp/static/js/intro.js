/* Site opening (about 4 s): a field of grey pixels drifts in, then organises itself into the letters S, V, D,
 * and the overlay fades to reveal the page. While an image is being loaded ("upload" mode) the older
 * matrix / U Sigma V^T / rank-k rebuild animation from anim/processing.js plays instead.
 * Canvas 2D, deterministic, no network, no SVD in the browser. */
import { $, on, reducedMotion } from "./core.js";
import { createPlayer, lerp, seg } from "./anim/player.js";
import { drawProcessing, PROCESSING_DURATION } from "./anim/processing.js";

const W = 640, H = 360;
const DURATION = 4.0, FADE_MS = 450;
const KEY = "svdlab-intro-seen";
const TAG = "An image, rebuilt through linear algebra.";
const BG = "#15171c";
let introOff = false;

function rng(seed) { // mulberry32
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(248);

// 5 x 7 pixel font for the three letters
const FONT = {
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
};
const CELL = 21, PIX = 17, COLS = 17;
const X0 = (W - COLS * CELL) / 2 + (CELL - PIX) / 2, Y0 = 92;
const TARGETS = [];
"SVD".split("").forEach((ch, li) => FONT[ch].forEach((row, r) => [...row].forEach((bit, c) => {
  if (bit === "1") TARGETS.push({ x: X0 + (li * 6 + c) * CELL, y: Y0 + r * CELL, word: li });
})));
const N_DUST = 230;
const PIXELS = [];
for (let i = 0; i < TARGETS.length + N_DUST; i++) {
  const target = TARGETS[i] || null;
  PIXELS.push({
    x: rand() * (W - PIX), y: rand() * (H - PIX), g: 70 + rand() * 130, size: 6 + rand() * 9,
    delay: rand() * 0.55, tx: target?.x, ty: target?.y, lit: !!target, fade: 0.1 + rand() * 0.5,
    dx: (rand() - 0.5) * 40, dy: (rand() - 0.5) * 40,
  });
}

function draw(ctx, t) {
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const appear = (p) => seg(t, p.delay * 0.9, p.delay * 0.9 + 0.5);      // 0 - 1.1 s: the field fades in
  const gather = (p) => seg(t, 1.3 + p.delay * 0.6, 2.5 + p.delay * 0.4); // 1.3 - 2.9 s: pixels organise
  for (const p of PIXELS) {
    const a = appear(p), g = gather(p);
    const drift = (1 - g) * Math.sin(t * 1.6 + p.delay * 9);
    if (p.lit) {
      const x = lerp(p.x + p.dx * drift, p.tx, g), y = lerp(p.y + p.dy * drift, p.ty, g), size = lerp(p.size, PIX, g);
      const v = lerp(p.g, 247, g), shade = Math.round(v);
      ctx.fillStyle = g > 0.98 ? "#f7f3ea" : `rgb(${shade},${shade},${Math.round(lerp(v, 255, g))})`;
      ctx.globalAlpha = Math.min(1, a + g);
      ctx.fillRect(x, y, size, size);
      if (g > 0.98) { // settled letters pick up the accent colour from left to right
        const glow = seg(t, 2.7 + p.word * 0.15, 3.1 + p.word * 0.15);
        if (glow > 0) { ctx.globalAlpha = glow; ctx.fillStyle = "#8fb0ee"; ctx.fillRect(x, y, size, size); }
      }
    } else {
      const x = p.x + p.dx * drift + g * p.dx * 3, y = p.y + p.dy * drift + g * p.dy * 3;
      ctx.fillStyle = `rgb(${p.g | 0},${p.g | 0},${p.g | 0})`;
      ctx.globalAlpha = a * (1 - seg(t, 1.5 + p.fade, 2.6 + p.fade)) * 0.9;
      ctx.fillRect(x, y, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- overlay control ----------
let curMode = "intro", overlay, skipBtn, titleEl, tagEl, ctx, player = null, active = false, lastFocus = null, endTimer = 0, onKey = null, onHide = null;

function setInert(on) {
  for (const node of Array.from(document.body.children)) {
    if (node === overlay || node.tagName === "SCRIPT") continue;
    if (on) node.setAttribute("inert", ""); else node.removeAttribute("inert");
  }
}

function finish() {
  if (!active) return;
  active = false;
  clearTimeout(endTimer);
  player?.stop(); player = null;
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("visibilitychange", onHide);
  window.removeEventListener("pagehide", onHide);
  overlay.classList.add("is-leaving");
  const done = () => {
    overlay.classList.remove("is-on", "is-leaving", "is-static");
    titleEl.classList.remove("is-on");
    overlay.setAttribute("aria-modal", "false");
    setInert(false);
    document.body.classList.remove("intro-lock");
    const back = lastFocus && document.contains(lastFocus) && lastFocus !== document.body ? lastFocus : (() => {
      const top = $("#top") || document.body; if (!top.hasAttribute("tabindex")) top.setAttribute("tabindex", "-1"); return top;
    })();
    if (curMode === "upload") { $("#lab-analysis")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); return; }
    try { back.focus({ preventScroll: false }); } catch { /* ignore */ }
  };
  if (reducedMotion()) done(); else setTimeout(done, FADE_MS);
}

export function playIntro({ force = false, mode = "intro" } = {}) {
  if (!overlay) return;
  curMode = mode;
  overlay.dataset.mode = mode;
  tagEl.textContent = TAG;
  if (active) return; // already playing (the page underneath is inert)
  const reduced = reducedMotion();
  if (reduced && !force) return;
  lastFocus = document.activeElement;
  active = true;
  try { sessionStorage.setItem(KEY, "1"); } catch { /* private mode */ }
  overlay.classList.remove("is-leaving");
  overlay.classList.add("is-on");
  overlay.setAttribute("aria-modal", "true");
  document.body.classList.add("intro-lock");
  setInert(true);
  skipBtn.focus();

  onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); finish(); }
    else if (e.key === "Tab") { e.preventDefault(); skipBtn.focus(); }
  };
  onHide = (e) => { if (e.type === "pagehide" || document.hidden) finish(); };
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);

  if (reduced) { // static title card, no motion
    overlay.classList.add("is-static");
    titleEl.classList.add("is-on");
    endTimer = setTimeout(finish, 1000);
    return;
  }
  overlay.classList.remove("is-static");
  titleEl.classList.remove("is-on");
  draw(ctx, 0);
  const scene = mode === "upload" ? drawProcessing : draw;
  player = createPlayer({
    duration: mode === "upload" ? PROCESSING_DURATION : DURATION,
    onFrame: (t) => { scene(ctx, t); if (t >= 2.9) titleEl.classList.add("is-on"); },
    onState: (s) => { if (s === "ended") endTimer = setTimeout(finish, 150); },
  });
  player.play();
}

export function init() {
  overlay = $("#intro"); skipBtn = $("#intro-skip"); titleEl = $("#intro-title"); tagEl = $("#intro-tag");
  if (!overlay || !skipBtn) return;
  const canvas = $("#intro-canvas");
  ctx = canvas.getContext("2d");
  skipBtn.addEventListener("click", finish);
  let seen = false;
  try { seen = sessionStorage.getItem(KEY) === "1"; } catch { /* ignore */ }
  introOff = new URLSearchParams(location.search).get("intro") === "0";
  if (!seen && !introOff) playIntro();
  // Every loaded image (upload or sample) gets the pixel animation before the output is shown.
  on("lab:image", () => { if (!introOff) playIntro({ mode: "upload" }); });
}
