/* Learning journey (#learn) and live lines of the mathematics explorer (#math).
 * Widgets are small and self-contained; every number in the 2x2 examples is a hand-written exact value.
 * Numbers about the user's own image come only from the `lab:svd` / `lab:rank` payloads (the Flask engine). */
import { $, $$, el, svg, on, emit, state, reducedMotion } from "./core.js";
import { matrixEl, setCls, minus } from "./learn/ui.js";
import { mountMul } from "./learn/mulstep.js";

export function init() {
  const mount = {
    pixels: mountPixels, "rgb-hint": mountRgb, rowcol: mountRowCol, mul: mountMulWidget, rank: mountRank,
    transpose: mountTranspose, eigen: mountEigen, rankstep: mountRankStep, lablink: mountLabLink,
  };
  for (const host of $$("#learn .lj-widget")) {
    try { mount[host.dataset.widget]?.(host); } catch (err) { console.error("learn widget failed", host.dataset.widget, err); }
  }
  setupIndex();
  renderLive();
  on("lab:svd", renderLive);
  on("lab:rank", renderLive);
}

/* ---------------- chapter index / progress ---------------- */
function setupIndex() {
  const links = $$(".lj-index a");
  const prog = $("[data-testid=learn-progress]");
  const mark = (n) => {
    links.forEach((a) => { if (+a.dataset.goto !== n) a.removeAttribute("aria-current"); else a.setAttribute("aria-current", "true"); });
    if (prog) prog.textContent = `Chapter ${n} of 15`;
    const cur = links.find((a) => +a.dataset.goto === n);
    const ol = cur?.closest("ol");
    if (ol && ol.scrollWidth > ol.clientWidth) ol.scrollLeft = cur.offsetLeft - ol.clientWidth / 2 + cur.offsetWidth / 2;
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) mark(+e.target.dataset.ch);
  }, { rootMargin: "-25% 0px -65% 0px" });
  $$("#learn .lj-ch").forEach((a) => io.observe(a));
  mark(1);
  links.forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const t = $(`#ch-${a.dataset.goto}`);
    t.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    const h = t.querySelector("h3"); h.tabIndex = -1; h.focus({ preventScroll: true });
    mark(+a.dataset.goto);
  }));
}

/* ---------------- Animation A: from pixels to matrices ---------------- */
function mountPixels(host) {
  const N = 16, W = 8;
  let gray = null, rgb = null, sel = [6, 6], zoom = false, showRgb = false, win = [0, 0];
  const grid = el("div", { class: "lj-pxgrid", role: "group", "aria-label": "16 by 16 pixel grid of the sample image. Use the arrow keys to move between pixels." });
  const inner = el("div", { class: "lj-pxinner" }, grid);
  const view = el("div", { class: "lj-pxview" }, inner);
  const matHost = el("div", { class: "lj-pxmat" });
  const readout = el("p", { class: "lj-readout", "aria-live": "polite", "data-testid": "px-readout" });
  const rgbOut = el("p", { class: "lj-rgb mono", hidden: true, "data-testid": "px-rgb" });
  const zoomBtn = el("button", { class: "btn", type: "button", "aria-pressed": "false", "data-testid": "px-zoom", text: "Zoom in on the 8×8 window" });
  const rgbBtn = el("button", { class: "btn", type: "button", "aria-pressed": "false", "data-testid": "px-rgb-toggle", text: "Show colour: RGB = 3 numbers" });
  const fig = el("figure", { class: "lj-pxfig" }, view, el("figcaption", { text: "Fig. 1  The 16×16 sample image tiny-face as pixels (left) and as the matrix of its brightness values (right). The outlined window is the 8×8 block of the matrix shown." }));
  host.replaceChildren(
    el("p", { class: "lj-statement", text: "An image is a collection of numbers arranged in rows and columns." }),
    el("div", { class: "lj-pxlayout" }, fig, matHost),
    readout, rgbOut,
    el("div", { class: "lj-ctrl" }, zoomBtn, rgbBtn));

  const cells = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const b = el("button", { class: "lj-px", type: "button", tabindex: "-1" });
    b.dataset.r = r; b.dataset.c = c;
    b.setAttribute("aria-label", `row ${r + 1}, column ${c + 1}`);
    grid.append(b); cells.push(b);
  }
  const at = (r, c) => cells[r * N + c];

  function select(r, c, { focus = false } = {}) {
    sel = [Math.max(0, Math.min(N - 1, r)), Math.max(0, Math.min(N - 1, c))];
    update();
    if (focus) at(sel[0], sel[1]).focus();
  }
  function update() {
    if (!gray) return;
    const [r, c] = sel;
    win = [Math.max(0, Math.min(N - W, r - W / 2)), Math.max(0, Math.min(N - W, c - W / 2))];
    cells.forEach((b, i) => {
      const rr = (i / N) | 0, cc = i % N;
      b.tabIndex = rr === r && cc === c ? 0 : -1;
      b.classList.toggle("is-sel", rr === r && cc === c);
      b.classList.toggle("in-win", rr >= win[0] && rr < win[0] + W && cc >= win[1] && cc < win[1] + W);
      b.style.background = showRgb ? `rgb(${rgb[i].join(",")})` : `rgb(${gray[i]},${gray[i]},${gray[i]})`;
      b.setAttribute("aria-label", `row ${rr + 1}, column ${cc + 1}, value ${gray[i]}`);
    });
    const rows = [];
    for (let i = 0; i < W; i++) rows.push(Array.from({ length: W }, (_, j) => gray[(win[0] + i) * N + win[1] + j]));
    const mat = matrixEl(rows, { cls: "lj-m--px", label: `Matrix entries of rows ${win[0] + 1} to ${win[0] + W}, columns ${win[1] + 1} to ${win[1] + W}` });
    const colHead = el("div", { class: "lj-mhead", "aria-hidden": "true" }, Array.from({ length: W }, (_, j) => el("span", { text: win[1] + j + 1 })));
    const rowHead = el("div", { class: "lj-mside", "aria-hidden": "true" }, Array.from({ length: W }, (_, i) => el("span", { text: win[0] + i + 1 })));
    matHost.replaceChildren(el("p", { class: "lj-mcap", text: `Matrix A, rows ${win[0] + 1}–${win[0] + W}, columns ${win[1] + 1}–${win[1] + W} (of 16)` }),
      el("div", { class: "lj-mwrap" }, el("div", {}, colHead, el("div", { class: "lj-mrow" }, rowHead, mat.root))));
    setCls(mat.cells, (i, j) => win[0] + i === r && win[1] + j === c, "hl");
    setCls(mat.cells, (i, j) => (win[0] + i === r) !== (win[1] + j === c), "soft");
    const v = gray[r * N + c];
    readout.textContent = `Pixel in row ${r + 1}, column ${c + 1} has brightness ${v} (0 = black, 255 = white). Matrix entry a(${r + 1},${c + 1}) = ${v}.`;
    const px = rgb[r * N + c];
    rgbOut.hidden = !showRgb;
    rgbOut.textContent = `RGB pixel (${r + 1},${c + 1}) = (R, G, B) = (${px.join(", ")}): three numbers instead of one. Grey value used in the matrix: ${v}.`;
    applyZoom();
  }
  function applyZoom() {
    inner.style.transform = zoom ? `scale(2) translate(${-(win[1] / N) * 100}%, ${-(win[0] / N) * 100}%)` : "none";
    view.classList.toggle("is-zoom", zoom);
  }
  grid.addEventListener("pointerover", (e) => { const b = e.target.closest(".lj-px"); if (b && e.pointerType !== "touch") select(+b.dataset.r, +b.dataset.c); });
  grid.addEventListener("click", (e) => { const b = e.target.closest(".lj-px"); if (b) select(+b.dataset.r, +b.dataset.c); });
  grid.addEventListener("focusin", (e) => { const b = e.target.closest(".lj-px"); if (b && (+b.dataset.r !== sel[0] || +b.dataset.c !== sel[1])) select(+b.dataset.r, +b.dataset.c); });
  grid.addEventListener("keydown", (e) => {
    const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (d) { e.preventDefault(); select(sel[0] + d[0], sel[1] + d[1], { focus: true }); }
    if (e.key === "Home") { e.preventDefault(); select(sel[0], 0, { focus: true }); }
    if (e.key === "End") { e.preventDefault(); select(sel[0], N - 1, { focus: true }); }
  });
  zoomBtn.addEventListener("click", () => { zoom = !zoom; zoomBtn.setAttribute("aria-pressed", String(zoom)); zoomBtn.textContent = zoom ? "Zoom out" : "Zoom in on the 8×8 window"; applyZoom(); });
  rgbBtn.addEventListener("click", () => { showRgb = !showRgb; rgbBtn.setAttribute("aria-pressed", String(showRgb)); update(); });

  readout.textContent = "Loading the sample image…";
  const img = new Image();
  img.onload = () => {
    try {
      const cv = document.createElement("canvas"); cv.width = N; cv.height = N;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, N, N);
      const d = ctx.getImageData(0, 0, N, N).data;
      gray = []; rgb = [];
      for (let i = 0; i < N * N; i++) {
        const R = d[4 * i], G = d[4 * i + 1], B = d[4 * i + 2];
        rgb.push([R, G, B]);
        gray.push(Math.round(0.299 * R + 0.587 * G + 0.114 * B));
      }
      select(sel[0], sel[1]);
    } catch { readout.textContent = "The sample image could not be read in this browser."; }
  };
  img.onerror = () => { readout.textContent = "The sample image could not be loaded."; };
  img.src = "/samples/tiny-face.png";
}

/* Chapter 2: an RGB pixel is three numbers */
function mountRgb(host) {
  const vals = [200, 40, 40];
  const sw = el("div", { class: "lj-swatch", role: "img", "aria-label": "colour swatch" });
  const out = el("p", { class: "mono lj-readout", "aria-live": "polite" });
  const mk = (name, i) => {
    const inp = el("input", { type: "range", min: "0", max: "255", value: String(vals[i]), "aria-label": `${name} value, 0 to 255` });
    inp.addEventListener("input", () => { vals[i] = +inp.value; draw(); });
    return el("label", { class: "field" }, name, inp);
  };
  const draw = () => { sw.style.background = `rgb(${vals.join(",")})`; out.textContent = `(R, G, B) = (${vals.join(", ")})`; };
  host.replaceChildren(el("p", { class: "lj-mcap", text: "A colour pixel is three numbers. Move the sliders." }), sw, mk("Red", 0), mk("Green", 1), mk("Blue", 2), out);
  draw();
}

/* Chapter 4: click an entry to see its row and column */
function mountRowCol(host) {
  const B = [[1, 2], [3, 4], [5, 6]];
  const m = matrixEl(B, { tag: "button", label: "Matrix B, 3 rows and 2 columns" });
  const out = el("p", { class: "lj-readout", "aria-live": "polite", "data-testid": "rc-readout" });
  const pick = (i, j) => {
    setCls(m.cells, (a) => a === i, "hl");
    setCls(m.cells, (_, b) => b === j, "hl2");
    out.textContent = `Entry b(${i + 1},${j + 1}) = ${B[i][j]}. Row ${i + 1} is (${B[i].join(", ")}), column ${j + 1} is (${B.map((r) => r[j]).join(", ")}).`;
  };
  m.cells.forEach((r, i) => r.forEach((c, j) => { c.addEventListener("click", () => pick(i, j)); c.addEventListener("focus", () => pick(i, j)); }));
  host.replaceChildren(el("p", { class: "lj-mcap", text: "B is 3×2: three rows, two columns. Blue = its row, orange = its column." }), m.root, out);
  pick(1, 0);
}

/* Chapter 5: Animation B */
function mountMulWidget(host) {
  mountMul(host, { L: [[3, 1], [1, 3]], R: [[1, 2], [1, 0]], leftName: "A", rightName: "B", outName: "C", testid: "mul" });
}

/* Chapter 7: rank */
function mountRank(host) {
  const P = [[1, 2], [2, 4]], I2 = [[1, 0], [0, 1]];
  const mp = matrixEl(P, { label: "Matrix P" }), mi = matrixEl(I2, { label: "Identity matrix" });
  const out = el("p", { class: "lj-readout", "aria-live": "polite", "data-testid": "rank-readout" });
  const bp = el("button", { class: "btn", type: "button", "aria-pressed": "false", "data-testid": "rank-p", text: "Test the rows of P" });
  const bi = el("button", { class: "btn", type: "button", "aria-pressed": "false", "data-testid": "rank-i", text: "Test the rows of I" });
  const clear = (m) => { setCls(m.cells, () => false, "hl"); setCls(m.cells, () => false, "hl2"); };
  bp.addEventListener("click", () => {
    bp.setAttribute("aria-pressed", "true"); bi.setAttribute("aria-pressed", "false");
    clear(mi); setCls(mp.cells, (i) => i === 0, "hl"); setCls(mp.cells, (i) => i === 1, "hl2");
    out.textContent = "Row 2 = 2 × row 1 = 2·(1, 2) = (2, 4). The second row adds nothing new, so rank(P) = 1 (one nonzero singular value, √25 = 5; the other is 0).";
  });
  bi.addEventListener("click", () => {
    bi.setAttribute("aria-pressed", "true"); bp.setAttribute("aria-pressed", "false");
    clear(mp); setCls(mi.cells, (i) => i === 0, "hl"); setCls(mi.cells, (i) => i === 1, "hl2");
    out.textContent = "(1, 0) and (0, 1): neither is a multiple of the other, so the two rows are independent and rank(I) = 2.";
  });
  host.replaceChildren(
    el("div", { class: "lj-pair" }, el("figure", { class: "lj-mfig" }, mp.root, el("figcaption", { text: "P" })), el("figure", { class: "lj-mfig" }, mi.root, el("figcaption", { text: "I" }))),
    el("div", { class: "lj-ctrl" }, bp, bi), out);
  bp.click();
}

/* Chapter 8: transpose */
function mountTranspose(host) {
  const A = [[1, 2, 3], [4, 5, 6]];
  const At = A[0].map((_, j) => A.map((r) => r[j]));
  const ma = matrixEl(A, { tabs: true, label: "Matrix A, 2 by 3" }), mt = matrixEl(At, { label: "Transpose of A, 3 by 2" });
  const out = el("p", { class: "lj-readout", "aria-live": "polite", "data-testid": "tr-readout" });
  const pick = (i, j) => {
    setCls(ma.cells, (a, b) => a === i && b === j, "hl"); setCls(ma.cells, (a, b) => a === i && b !== j, "soft");
    setCls(mt.cells, (a, b) => a === j && b === i, "hl"); setCls(mt.cells, (a, b) => b === i && a !== j, "soft");
    out.textContent = `a(${i + 1},${j + 1}) = ${A[i][j]} moves to position (${j + 1},${i + 1}) of the transpose. Row ${i + 1} of A becomes column ${i + 1} of Aᵀ.`;
  };
  ma.cells.forEach((r, i) => r.forEach((c, j) => {
    c.addEventListener("pointerenter", () => pick(i, j)); c.addEventListener("focus", () => pick(i, j)); c.addEventListener("click", () => pick(i, j));
  }));
  host.replaceChildren(el("p", { class: "lj-mcap", text: "Hover or Tab through the numbers of A." }),
    el("div", { class: "lj-pair" }, el("figure", { class: "lj-mfig" }, ma.root, el("figcaption", { text: "A (2×3)" })), el("span", { class: "lj-op", "aria-hidden": "true", text: "→" }), el("figure", { class: "lj-mfig" }, mt.root, el("figcaption", { text: "Aᵀ (3×2)" }))), out);
  pick(0, 1);
}

/* Chapter 9: unit circle -> ellipse for A = [[3,1],[1,3]] */
function mountEigen(host) {
  const A = [[3, 1], [1, 3]], S = 30, V = 150;
  const ap = (x, y) => [A[0][0] * x + A[0][1] * y, A[1][0] * x + A[1][1] * y];
  const P = ([x, y]) => `${(x * S).toFixed(2)},${(-y * S).toFixed(2)}`;
  const circ = [], ell = [];
  for (let t = 0; t <= 120; t++) { const a = (t / 120) * 2 * Math.PI, c = [Math.cos(a), Math.sin(a)]; circ.push(P(c)); ell.push(P(ap(...c))); }
  const arrow = (id, color) => svg("marker", { id, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "6", markerHeight: "6", orient: "auto" }, svg("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));
  const vLine = svg("line", { x1: 0, y1: 0, stroke: "#1c1e23", "stroke-width": 2.5, "marker-end": "url(#lj-ar-ink)" });
  const avLine = svg("line", { x1: 0, y1: 0, stroke: "#1f4ea3", "stroke-width": 2.5, "marker-end": "url(#lj-ar-acc)" });
  const lab = (x, y, t, anchor = "middle") => svg("text", { x, y, "text-anchor": anchor, fill: "#4a4e57", "font-size": 11, "font-family": "monospace", text: t });
  const d1 = (4.6 * S) / Math.SQRT2, h = (4 * S) / Math.SQRT2, h2 = (2 * S) / Math.SQRT2;
  const s = svg("svg", { viewBox: `${-V} ${-V} ${2 * V} ${2 * V}`, role: "img", class: "lj-eig", "aria-label": "The unit circle is mapped by A to an ellipse with semi-axes 4 along (1,1) and 2 along (1,-1)." },
    svg("defs", {}, arrow("lj-ar-ink", "#1c1e23"), arrow("lj-ar-acc", "#1f4ea3")),
    svg("line", { x1: -V, y1: 0, x2: V, y2: 0, stroke: "#d9d2c2" }), svg("line", { x1: 0, y1: -V, x2: 0, y2: V, stroke: "#d9d2c2" }),
    svg("line", { x1: -d1, y1: d1, x2: d1, y2: -d1, stroke: "#4a4e57", "stroke-dasharray": "2 4" }),
    svg("line", { x1: -d1, y1: -d1, x2: d1, y2: d1, stroke: "#4a4e57", "stroke-dasharray": "2 4" }),
    svg("polyline", { points: ell.join(" "), fill: "#e3eaf6", "fill-opacity": 0.6, stroke: "#1f4ea3", "stroke-width": 2 }),
    svg("polyline", { points: circ.join(" "), fill: "none", stroke: "#4a4e57", "stroke-width": 1.5, "stroke-dasharray": "4 3" }),
    lab(h + 4, -h - 6, "λ=4", "start"), lab(-h2 - 4, -h2 - 6, "λ=2", "end"),
    lab(V - 4, 12, "x", "end"), lab(6, -V + 12, "y", "start"), vLine, avLine);
  const slider = el("input", { type: "range", min: "0", max: "355", step: "5", value: "45", "data-testid": "eig-angle", "aria-label": "Direction of the vector v, angle in degrees" });
  const out = el("p", { class: "lj-readout mono", "aria-live": "polite", "data-testid": "eig-readout" });
  function draw() {
    const th = +slider.value, a = (th * Math.PI) / 180, v = [Math.cos(a), Math.sin(a)], av = ap(...v);
    vLine.setAttribute("x2", v[0] * S); vLine.setAttribute("y2", -v[1] * S);
    avLine.setAttribute("x2", av[0] * S); avLine.setAttribute("y2", -av[1] * S);
    const f = (x) => minus(x.toFixed(3));
    let msg = `v = (${f(v[0])}, ${f(v[1])}),  Av = (${f(av[0])}, ${f(av[1])}),  |Av| = ${Math.hypot(...av).toFixed(3)}.`;
    const m = th % 180;
    if (m === 45) msg += "  Av = 4v: an eigenvector, λ = 4.";
    else if (m === 135) msg += "  Av = 2v: an eigenvector, λ = 2.";
    else msg += "  Av points in a different direction from v: not an eigenvector.";
    out.textContent = msg;
  }
  slider.addEventListener("input", draw);
  host.replaceChildren(
    el("p", { class: "lj-mcap", text: "Blue ellipse: all images Ax of unit vectors x (dashed circle). Slide v around the circle; Av is the blue arrow, v the black one." }),
    s, el("label", { class: "field" }, "Angle of v (degrees)", slider), out,
    el("p", { class: "lj-mcap", text: "At 45° and 135° the arrows line up: those are the eigen-directions (1,1) and (1,−1), and the ellipse semi-axes are 4 and 2." }));
  draw();
}

/* Chapters 13-14: rank-1, rank-2 with the real numbers of the 2x2 example */
function mountRankStep(host) {
  const data = [
    { k: 1, M: [[2, 2], [2, 2]], Rz: [[1, -1], [-1, 1]], E: "16/20 = 0.8 = 80 %", err: "√(1+1+1+1) = 2 = σ₂", note: "A₁ = σ₁u₁v₁ᵀ" },
    { k: 2, M: [[3, 1], [1, 3]], Rz: [[0, 0], [0, 0]], E: "(16+4)/20 = 1 = 100 %", err: "0", note: "A₂ = A₁ + σ₂u₂v₂ᵀ = A" },
  ];
  let i = 0;
  const box = el("div", { class: "lj-rs", "aria-live": "polite" });
  const mk = (d) => {
    const m = matrixEl(d.M, { tint: true, label: `A${d.k}` }), r = matrixEl(d.Rz, { tint: true, label: "residual" });
    return el("div", { class: "lj-rs-body" },
      el("div", { class: "lj-pair" }, el("figure", { class: "lj-mfig" }, m.root, el("figcaption", { text: `Aₖ for k = ${d.k}` })), el("figure", { class: "lj-mfig" }, r.root, el("figcaption", { text: "A − Aₖ" }))),
      el("p", { class: "mono lj-readout", "data-testid": "rs-readout", text: `${d.note}. Energy E(${d.k}) = ${d.E}. Error ||A − Aₖ||F = ${d.err}.` }));
  };
  const btns = data.map((d, n) => el("button", { class: "btn", type: "button", "aria-pressed": String(n === 0), "data-testid": `rs-k${d.k}`, text: `k = ${d.k}` }));
  const prev = el("button", { class: "btn", type: "button", "data-testid": "rs-back", text: "Back" });
  const nxt = el("button", { class: "btn btn--primary", type: "button", "data-testid": "rs-next", text: "Next" });
  const go = (n) => { i = n; box.replaceChildren(mk(data[i])); btns.forEach((b, m) => b.setAttribute("aria-pressed", String(m === i))); prev.disabled = i === 0; nxt.disabled = i === data.length - 1; };
  btns.forEach((b, n) => b.addEventListener("click", () => go(n)));
  prev.addEventListener("click", () => go(Math.max(0, i - 1)));
  nxt.addEventListener("click", () => go(Math.min(data.length - 1, i + 1)));
  const tryBtn = el("button", { class: "btn", type: "button", "data-testid": "rs-try", text: "Try it on a real image" });
  tryBtn.addEventListener("click", () => emit("ui:section", "lab"));
  host.replaceChildren(el("p", { class: "lj-mcap", text: "The 2×2 example, tinted by value (blue positive, orange negative)." }), box,
    el("div", { class: "lj-ctrl", role: "group", "aria-label": "Rank stepper" }, prev, ...btns, nxt, tryBtn));
  go(0);
}

function mountLabLink(host) {
  const b = el("button", { class: "btn btn--primary", type: "button", "data-testid": "lab-link", text: "Try it on a real image" });
  b.addEventListener("click", () => emit("ui:section", "lab"));
  host.replaceChildren(b, el("div", { class: "lj-live", "data-live": "storage", "aria-live": "polite" }));
}

/* ---------------- live lines from the user's own image (engine numbers only) ---------------- */
const g4 = (x) => (x === null || x === undefined ? "–" : String(+Number(x).toPrecision(4)));
const pc = (x) => `${(100 * x).toFixed(2)} %`;
function prompt() {
  const b = el("button", { class: "btn btn--quiet", type: "button", text: "Go to the laboratory" });
  b.addEventListener("click", () => emit("ui:section", "lab"));
  return [el("span", { text: "No image analysed yet. Load one in the laboratory to see your own numbers here. " }), b];
}
function renderLive() {
  const sp = state.spectrum;
  const k = Math.max(1, state.k || 1);
  for (const box of $$("[data-live]")) {
    const kind = box.dataset.live;
    if (!sp || !sp.sigma) { box.replaceChildren(...prompt()); box.classList.add("is-empty"); continue; }
    box.classList.remove("is-empty");
    const sig = sp.sigma[0] || [], en = sp.energy || [], kk = Math.min(k, en.length || k);
    const E = en[kk - 1];
    const first = sig.slice(0, 5);
    if (kind === "sigma" || kind === "C") {
      const bars = first.map((s, i) => el("li", {}, el("span", { class: "mono", text: `σ${i + 1} = ${g4(s)}` }),
        el("span", { class: "lj-bar", "aria-hidden": "true" }, el("i", { style: `width:${(100 * s / (first[0] || 1)).toFixed(1)}%` }))));
      const lead = kind === "C" ? `Your image (first of ${sp.sigma.length} channel${sp.sigma.length > 1 ? "s" : ""}): the strongest layers by singular value.` : "Your image, first channel: the largest singular values, strongest first.";
      box.replaceChildren(el("p", { text: lead + (E !== undefined && kind === "C" ? ` Energy kept at k = ${kk}: ${pc(E)}.` : "") }), el("ul", { class: "lj-bars" }, bars));
    } else if (kind === "energy" || kind === "E" || kind === "rank") {
      const parts = [`Your image at k = ${kk}: energy retained E(k) = ${E !== undefined ? pc(E) : "–"}.`];
      if (kind === "rank" && sp.suggested_k) parts.push(`The laboratory suggests k = ${sp.suggested_k}, which keeps at least 99.99 % of the energy.`);
      box.replaceChildren(el("span", { text: parts.join(" ") }));
    } else if (kind === "F" || kind === "storage") {
      const [m, n] = sp.shape || [0, 0], C = sp.sigma.length;
      const stored = kk * (m + n + 1) * C, orig = m * n * C;
      box.replaceChildren(el("span", { text: `Your image (${m}×${n}, ${C} channel${C > 1 ? "s" : ""}) at k = ${kk}: k(m+n+1)·C = ${stored.toLocaleString("en-US")} scalars versus ${orig.toLocaleString("en-US")} pixel values (a count, not a file size).` }));
    }
  }
}
