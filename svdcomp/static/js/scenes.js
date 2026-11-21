/* Teaching scenes C (CSS-3D factorisation) and D (singular components).
 * Scene C is an illustration only (no computation). Scene D uses exact hard-coded 2x2 values in
 * "illustration" mode (cross-checked against /api/worked-example) and the real API results in "image" mode. */
import { $, $$, api, el, svg, on, state, reducedMotion, num } from "./core.js";
import { createPlayer, seg, diverging, textOn } from "./anim/player.js";

/* ------------------------------------------------------------------ Scene C */
const M = 6, N = 4; // example dimensions: A is 6x4, U 6x6, Sigma 6x4, V^T 4x4
const PARTS = [
  { id: "A", w: N, h: M, x: 0, z: 0, tag: "A", dims: "m × n" },
  { id: "U", w: M, h: M, x: -7.5, z: 2, tag: "U", dims: "m × m" },
  { id: "S", w: N, h: M, x: 0.5, z: 0, tag: "Σ", dims: "m × n" },
  { id: "V", w: N, h: N, x: 7.5, z: -2, tag: "V", sup: "T", dims: "n × n" },
];
const C_DURATION = 6;
const C_STEPS = [0, 1.8, 4.2, C_DURATION];
const C_STATUS = [
  "Step 0 of 3: the matrix A, m × n.",
  "Step 1 of 3: A is replaced by its three factors.",
  "Step 2 of 3: the factors move apart: U, Σ and V transpose.",
  "Step 3 of 3: A = U Σ V transpose. Done.",
];

function tagNode(p) {
  const t = el("div", { class: "sc-tag" }, el("span", { class: "sc-tag__l", text: p.tag }));
  if (p.sup) t.firstChild.append(el("sup", { text: p.sup }));
  t.append(el("span", { class: "sc-tag__d mono", text: p.dims }));
  return t;
}

function buildSlab(p) {
  const front = el("div", { class: "sc-f sc-f--front" });
  if (p.id === "S") {
    for (let i = 0; i < Math.min(M, N); i++) {
      front.append(el("i", { class: "sc-diag", style: `left:calc(var(--u)*${i});top:calc(var(--u)*${i});opacity:${[0.95, 0.75, 0.55, 0.38][i]}` }));
    }
  }
  const slab = el("div", { class: `sc-slab sc-slab--${p.id}`, "data-part": p.id, style: `--w:${p.w};--h:${p.h};--x:${p.x};--z:${p.z}` },
    front, el("div", { class: "sc-f sc-f--back" }),
    el("div", { class: "sc-f sc-f--right" }), el("div", { class: "sc-f sc-f--left" }),
    el("div", { class: "sc-f sc-f--top" }), el("div", { class: "sc-f sc-f--bottom" }), tagNode(p));
  return slab;
}

function build2D(host) {
  const u = 16, y0 = 40, cell = (x, y, w, h, extra = {}) => svg("rect", { x, y, width: w, height: h, class: "sc-svg__cell", ...extra });
  const grid = (id, x, w, h, diag) => {
    const g = svg("g", { "data-part": id });
    g.append(svg("rect", { x, y: y0, width: w * u, height: h * u, class: `sc-svg__slab sc-svg__slab--${id}` }));
    for (let i = 1; i < w; i++) g.append(svg("line", { x1: x + i * u, y1: y0, x2: x + i * u, y2: y0 + h * u, class: "sc-svg__grid" }));
    for (let j = 1; j < h; j++) g.append(svg("line", { x1: x, y1: y0 + j * u, x2: x + w * u, y2: y0 + j * u, class: "sc-svg__grid" }));
    if (diag) for (let i = 0; i < Math.min(w, h); i++) g.append(cell(x + i * u, y0 + i * u, u, u, { class: "sc-svg__diag", "fill-opacity": [0.95, 0.75, 0.55, 0.38][i] }));
    return g;
  };
  const text = (x, y, s, cls) => svg("text", { x, y, class: cls, "text-anchor": "middle", text: s });
  host.append(svg("title", { id: "scene-c-svg-title", text: "A equals U times Sigma times V transpose, with dimensions" }));
  const xs = { A: 10, U: 116, S: 232, V: 322 };
  host.append(grid("A", xs.A, N, M), grid("U", xs.U, M, M), grid("S", xs.S, N, M, true), grid("V", xs.V, N, N));
  host.append(text(90, y0 + 54, "=", "sc-svg__op"));
  const tag = (id, cx, s, sup, dims) => {
    const t = svg("text", { x: cx, y: 24, class: "sc-svg__tag", "text-anchor": "middle" });
    t.append(s); if (sup) t.append(svg("tspan", { class: "sc-svg__sup", dy: "-6", text: sup }));
    host.append(t, text(cx, y0 + M * u + 18, dims, "sc-svg__dim"));
  };
  tag("A", xs.A + N * u / 2, "A", "", "m × n");
  tag("U", xs.U + M * u / 2, "U", "", "m × m");
  tag("S", xs.S + N * u / 2, "Σ", "", "m × n, diagonal");
  tag("V", xs.V + N * u / 2, "V", "T", "n × n");
}

function initSceneC() {
  const world = $("#scene-c-world"); if (!world) return;
  const playBtn = $("#scene-c-play"), stepBtn = $("#scene-c-step"), resetBtn = $("#scene-c-reset"), toggle = $("#scene-c-2d");
  const status = $("#scene-c-status"), flat = $("#scene-c-flat"), stage = $("#scene-c-stage"), caps = $$("#scene-c-captions [data-part]");
  const reduced = reducedMotion();
  PARTS.forEach((p) => world.append(buildSlab(p)));
  build2D($("#scene-c-svg"));

  let lastStep = -1, view2d = false;
  const stepOf = (t) => (t >= C_STEPS[3] ? 3 : t >= C_STEPS[2] ? 2 : t >= C_STEPS[1] ? 1 : 0);
  function frame(t) {
    const p1 = seg(t, 0.6, 1.8), p2 = seg(t, 1.8, 4.2);
    world.style.setProperty("--p1", p1.toFixed(3));
    world.style.setProperty("--p2", p2.toFixed(3));
    world.style.setProperty("--ry", reduced ? "-8deg" : `${(-16 + 32 * (t / C_DURATION)).toFixed(2)}deg`);
    const s = stepOf(t);
    if (s !== lastStep) {
      lastStep = s; status.textContent = C_STATUS[s];
      const hl = s === 0 ? ["A"] : ["U", "S", "V"];
      caps.forEach((c) => c.classList.toggle("is-on", hl.includes(c.dataset.part)));
      $$(".sc-slab", world).forEach((sl) => sl.classList.toggle("is-hl", hl.includes(sl.dataset.part)));
    }
  }
  const player = createPlayer({
    duration: C_DURATION, onFrame: frame,
    onState: (s) => { playBtn.textContent = s === "playing" ? "Pause" : s === "ended" ? "Replay" : "Play"; },
  });
  frame(0); player.stop();

  function play() {
    if (view2d) return;
    if (reduced) { player.stop(true); return; }
    if (player.state === "playing") player.pause(); else player.play();
  }
  playBtn.addEventListener("click", play);
  stepBtn.addEventListener("click", () => {
    player.pause();
    const cur = stepOf(player.time), next = (cur + 1) % 4;
    player.seek(C_STEPS[next]);
    playBtn.textContent = next === 3 ? "Replay" : "Play";
  });
  resetBtn.addEventListener("click", () => { player.stop(); player.seek(0); playBtn.textContent = "Play"; });

  function setView(v2) {
    view2d = v2;
    toggle.setAttribute("aria-pressed", String(v2));
    toggle.textContent = v2 ? "3D view" : "2D view";
    stage.classList.toggle("hidden", v2);
    flat.classList.toggle("sc-vh", !v2);
    [playBtn, stepBtn, resetBtn].forEach((b) => { b.disabled = v2; });
    if (v2) { player.pause(); status.textContent = "2D view: the same three factors as a static labelled diagram."; }
    else { lastStep = -1; frame(player.time); }
  }
  toggle.addEventListener("click", () => setView(!view2d));
  if (reduced) { player.seek(C_DURATION); setView(true); playBtn.textContent = "Replay"; }

  // play once when scrolled into view (never when reduced motion is requested)
  if (!reduced && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); if (!view2d && player.state === "idle") player.play(); }
    }, { threshold: 0.6 });
    io.observe(stage);
  }
}

/* ------------------------------------------------------------------ Scene D */
const SUB = (n) => el("sub", { text: String(n) });
const termLabel = (i) => el("span", { class: "sc-d-lab" }, "σ", SUB(i), el("b", { text: "u" }), SUB(i), el("b", { text: "v" }), SUB(i), el("sup", { text: "T" }));

function matrixView(rows, vmax) {
  const m = el("div", { class: "matrix sc-d-matrix", role: "img", style: `grid-template-columns:repeat(${rows[0].length},auto)`,
    "aria-label": `matrix ${rows.map((r) => r.join(", ")).join("; ")}` });
  for (const r of rows) for (const v of r) {
    m.append(el("span", { style: `background:${diverging(v, vmax)};color:${textOn(v, vmax)}`, "aria-hidden": "true", text: String(v) }));
  }
  return m;
}

const EX = {
  terms: [[[2, 2], [2, 2]], [[1, -1], [-1, 1]]],
  sum: [[3, 1], [1, 3]], sigma: [4, 2],
  notes: ["σ₁ = 4, u₁ = (1, 1)/√2, v₁ = (1, 1)/√2", "σ₂ = 2, u₂ = (1, −1)/√2, v₂ = (1, −1)/√2"],
};

function initSceneD() {
  const body = $("#scene-d-body"); if (!body) return;
  const modeBox = $("#scene-d-mode"), bEx = $("#scene-d-m-ex"), bImg = $("#scene-d-m-img");
  const playBtn = $("#scene-d-play"), resetBtn = $("#scene-d-reset"), status = $("#scene-d-status"), title = $("#scene-d-title"), prompt = $("#scene-d-prompt");
  const reduced = reducedMotion();
  let mode = "example", real = null, abort = null, reveals = [], verified = "";

  const player = createPlayer({
    duration: 3.2,
    onFrame: (t) => reveals.forEach((r) => { const o = seg(t, r.a, r.b); r.el.style.opacity = o.toFixed(3); r.el.style.transform = `translateY(${((1 - o) * 10).toFixed(1)}px)`; }),
    onState: (s) => { playBtn.textContent = s === "playing" ? "Pause" : s === "ended" ? "Replay" : "Play"; },
  });
  const rest = () => { player.stop(true); playBtn.textContent = "Play"; };
  const sign = (s, a, b) => { const e = el("span", { class: "sc-d-sign", "aria-hidden": "true", text: s }); reveals.push({ el: e, a, b }); return e; };
  const item = (content, a, b) => { reveals.push({ el: content, a, b }); return content; };

  function renderExample() {
    reveals = []; body.replaceChildren();
    title.textContent = "Illustration with the 2×2 matrix A = [[3, 1], [1, 3]] (exact values, σ1 = 4, σ2 = 2)." + verified;
    const fig = (i, rows, note) => item(el("figure", { class: "sc-d-fig" }, termLabel(i), matrixView(rows, 2),
      el("figcaption", { class: "mono" }, note)), (i - 1) * 1.0, (i - 1) * 1.0 + 0.8);
    const sumFig = item(el("figure", { class: "sc-d-fig" }, el("span", { class: "sc-d-lab" }, "A = sum"), matrixView(EX.sum, 3),
      el("figcaption", { class: "mono" }, "(3, 1; 1, 3): the original matrix")), 2.1, 3.0);
    body.append(el("div", { class: "sc-d-row" }, fig(1, EX.terms[0], EX.notes[0]), sign("+", 0.9, 1.5), fig(2, EX.terms[1], EX.notes[1]), sign("=", 1.9, 2.4), sumFig),
      el("p", { class: "muted sc-d-foot" }, "A 2×2 matrix has only two components; with a real image the first three are shown. Rank 1 already captures 16/20 = 80 % of the energy."));
    status.textContent = "Showing the 2×2 illustration.";
    prompt.replaceChildren();
    if (!real) prompt.append("No image is decomposed yet: ", el("a", { href: "#lab", text: "load one in the laboratory" }), " to see its real components here.");
    rest();
  }

  function renderImage() {
    reveals = []; body.replaceChildren();
    const { info, comps, recons } = real;
    const name = info.source?.sample ? `bundled sample "${info.source.sample}"` : `uploaded ${info.source?.format || "image"}`;
    title.textContent = `From your image: ${name}, ${info.width}×${info.height}, ${info.channels === 1 ? "gray" : "colour"}.`;
    const thumb = (src, alt) => el("img", { class: "sc-d-img", src, alt, width: 160, height: 160 });
    const comp = (i) => {
      const c = comps[i], sig = c.sigma.map((s) => num(s, 1)).join(" / ");
      return el("figure", { class: "sc-d-fig" }, termLabel(i + 1),
        thumb(c.image, `Component ${i + 1} of your image, signed values in cobalt and vermilion`),
        el("figcaption", { class: "mono" }, `σ${i + 1} = ${sig}`, el("br"), `energy share ${num(100 * c.energy_share, 1)} %`));
    };
    const sum = (k, label) => el("figure", { class: "sc-d-fig" }, el("span", { class: "sc-d-lab", text: label }),
      thumb(recons[k - 1].image, `Real reconstruction of your image from the first ${k} component${k > 1 ? "s" : ""}`),
      el("figcaption", { class: "mono" }, `rank ${k}: ${num(100 * comps[k - 1].energy_cumulative, 1)} % of energy`));
    const rows = [
      [comp(0), "=", sum(1, "running sum, k = 1")],
      [sum(1, "k = 1"), "+", comp(1), "=", sum(2, "running sum, k = 2")],
      [sum(2, "k = 2"), "+", comp(2), "=", sum(3, "running sum, k = 3")],
    ];
    rows.forEach((cells, r) => {
      const row = el("div", { class: "sc-d-row" });
      cells.forEach((c, ci) => { typeof c === "string" ? row.append(sign(c, r * 1.0, r * 1.0 + 0.5)) : row.append(item(c, r * 1.0 + ci * 0.05, r * 1.0 + 0.8)); });
      body.append(row);
    });
    if (info.channels > 1) body.append(el("p", { class: "muted sc-d-foot", text: "For colour images the component shown is the mean of the three channels' components; σ values are listed for R / G / B." }));
    status.textContent = "Showing real components and reconstructions from the server.";
    prompt.replaceChildren();
    rest();
  }

  function setMode(m) {
    mode = m === "image" && real ? "image" : "example";
    modeBox.dataset.mode = mode;
    bEx.setAttribute("aria-pressed", String(mode === "example"));
    bImg.setAttribute("aria-pressed", String(mode === "image"));
    bImg.disabled = !real;
    (mode === "image" ? renderImage : renderExample)();
  }
  bEx.addEventListener("click", () => setMode("example"));
  bImg.addEventListener("click", () => setMode("image"));
  playBtn.addEventListener("click", () => {
    if (reduced) { rest(); return; }
    if (player.state === "playing") player.pause(); else { if (player.state === "ended") player.seek(0); player.play(); }
  });
  resetBtn.addEventListener("click", () => { player.stop(); player.seek(0); playBtn.textContent = "Play"; });

  async function loadReal() {
    abort?.abort();
    const info = state.info, token = info?.token;
    if (!token) return;
    const ctl = (abort = new AbortController());
    const max = Math.max(1, Math.min(3, state.spectrum?.max_rank || 3));
    if (max < 3) return; // fewer than three components: keep the illustration
    try {
      const q = (path) => api(`${path}&token=${encodeURIComponent(token)}`, { signal: ctl.signal });
      const ids = [1, 2, 3];
      const [comps, recons] = await Promise.all([
        Promise.all(ids.map((i) => q(`/api/component?i=${i}`))),
        Promise.all(ids.map((k) => q(`/api/reconstruct?k=${k}`))),
      ]);
      if (ctl.signal.aborted || state.info?.token !== token) return; // image changed meanwhile
      real = { token, info, comps, recons };
      setMode("image");
    } catch (err) {
      if (err.name !== "AbortError") console.debug("scene D: real components unavailable, keeping the illustration", err.message);
      if (!ctl.signal.aborted) { real = null; setMode("example"); }
    }
  }
  on("lab:image", () => { abort?.abort(); real = null; setMode("example"); });
  on("lab:svd", () => { loadReal(); });

  // cross-check the hard-coded 2x2 values against the package (quietly)
  api("/api/worked-example").then((w) => {
    const same = (a, b) => a.every((r, i) => r.every((v, j) => Math.abs(v - b[i][j]) < 1e-9));
    if (w.rank_one_terms && w.rank_one_terms.every((t, k) => same(t, EX.terms[k])) && same(w.A, EX.sum)) {
      verified = " Cross-checked against the package's own computation."; if (mode === "example") title.textContent += verified;
    }
  }).catch(() => {});

  setMode("example");
  if (state.info && state.spectrum) loadReal();
}

export function init() {
  initSceneC();
  initSceneD();
}
