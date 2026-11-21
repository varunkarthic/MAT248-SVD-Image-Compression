/* The 2x2 worked example (#worked): step reveal, board mode, animated verification, geometry, engine check.
 * All displayed numbers are exact hand values written in the template; the engine check only COMPARES them
 * with GET /api/worked-example. */
import { $, $$, el, svg, api, on, reducedMotion } from "./core.js";
import { mountMul } from "./learn/mulstep.js";

const TOTAL = 12;

export function init() {
  const root = $("#worked");
  if (!root) return;
  setupStepper(root);
  mountVerify();
  mountA1();
  drawGeometry();
  setupEngine(root);
}

/* ---------------- stepper + board mode ---------------- */
function setupStepper(root) {
  const steps = $$(".wk-step", root);
  const status = $("#w-status"), back = $("#w-back"), next = $("#w-next"), reveal = $("#w-reveal"), reset = $("#w-reset"), boardBtn = $("#w-board");
  let cur = TOTAL, all = true, board = false, line = 0;

  const boardLines = () => $$(".wk-line", root).filter((l) => getComputedStyle(l).display !== "none" || l.closest(".wk-step").classList.contains("wk-hide"));
  const visibleLines = () => {
    const detail = document.body.dataset.detail === "details";
    return $$(".wk-line", root).filter((l) => detail || !l.classList.contains("only-details"));
  };

  function render() {
    root.classList.toggle("wk-board", board);
    boardBtn.setAttribute("aria-pressed", String(board));
    boardBtn.textContent = board ? "Leave board mode" : "Board mode";
    if (!board) {
      steps.forEach((s, i) => {
        s.classList.toggle("wk-hide", i + 1 > cur);
        s.classList.toggle("is-current", !all && i + 1 === cur);
        $$(".wk-line", s).forEach((l) => l.classList.remove("wk-hide"));
      });
      status.textContent = all ? `All ${TOTAL} steps shown.` : `Step ${cur} of ${TOTAL}.`;
      back.disabled = !all && cur <= 1;
      next.disabled = all || cur >= TOTAL;
      if (all) next.disabled = true;
    } else {
      const vl = visibleLines();
      line = Math.max(0, Math.min(vl.length - 1, line));
      $$(".wk-line", root).forEach((l) => l.classList.add("wk-hide"));
      vl.forEach((l, i) => l.classList.toggle("wk-hide", i > line));
      steps.forEach((s) => {
        const any = $$(".wk-line", s).some((l) => !l.classList.contains("wk-hide") && getComputedStyle(l).display !== "none");
        s.classList.toggle("wk-hide", !any);
        s.classList.remove("is-current");
        s.classList.toggle("is-current", any && $$(".wk-line", s).includes(vl[line]));
      });
      status.textContent = `Board: line ${line + 1} of ${vl.length}.`;
      back.disabled = line <= 0;
      next.disabled = line >= vl.length - 1;
    }
    reveal.disabled = board ? line >= visibleLines().length - 1 : all;
  }
  const focusCurrent = () => {
    const t = board ? visibleLines()[line] : steps[cur - 1];
    t?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: board ? "center" : "nearest" });
  };

  next.addEventListener("click", () => {
    if (board) line++; else if (cur < TOTAL) { cur++; all = false; }
    render(); focusCurrent();
  });
  back.addEventListener("click", () => {
    if (board) line--;
    else if (all) { all = false; cur = TOTAL - 1; }
    else if (cur > 1) cur--;
    render(); focusCurrent();
  });
  reveal.addEventListener("click", () => { if (board) line = visibleLines().length - 1; else { cur = TOTAL; all = true; } render(); });
  reset.addEventListener("click", () => { if (board) line = 0; else { cur = 1; all = false; } render(); focusCurrent(); });
  boardBtn.addEventListener("click", () => {
    board = !board;
    if (board) { line = 0; root.querySelector(".wk-controls").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); }
    else { cur = TOTAL; all = true; }
    render();
  });
  document.addEventListener("keydown", (e) => { if (board && e.key === "Escape") { board = false; cur = TOTAL; all = true; render(); } });
  on("ui:detail", () => { if (board) render(); });
  render();
}

/* ---------------- animated multiplications ---------------- */
function mountVerify() {
  const host = $('[data-widget="verify"]');
  if (!host) return;
  const h1 = el("div", { class: "wk-mul" }), h2 = el("div", { class: "wk-mul" });
  host.replaceChildren(
    el("p", { class: "lj-mcap", text: "Multiplication 1 of 2: UΣ (with the factor 1/√2 of U pulled out front)." }), h1,
    el("p", { class: "lj-mcap", text: "Multiplication 2 of 2: (UΣ)Vᵀ (the second 1/√2 pulled out front)." }), h2);
  mountMul(h1, {
    L: [[1, 1], [1, -1]], R: [[4, 0], [0, 2]], leftName: "√2·U", rightName: "Σ", outName: "√2·UΣ", testid: "wv1",
    final: { text: "Including the factor: UΣ = (1/√2) · this matrix.", rows: [[4, 2], [4, -2]] },
  });
  mountMul(h2, {
    L: [[4, 2], [4, -2]], R: [[1, 1], [1, -1]], leftName: "√2·UΣ", rightName: "√2·Vᵀ", outName: "2·UΣVᵀ", testid: "wv2",
    final: { text: "Multiply by (1/√2)(1/√2) = 1/2: [[6, 2], [2, 6]] · 1/2 = [[3, 1], [1, 3]] = A. Exactly the original matrix.", rows: [[3, 1], [1, 3]] },
  });
}

function mountA1() {
  const host = $('[data-widget="a1"]');
  if (!host) return;
  mountMul(host, {
    L: [[1], [1]], R: [[1, 1]], leftName: "√2·u₁", rightName: "√2·v₁ᵀ", outName: "2·u₁v₁ᵀ", tint: true, testid: "wa1",
    final: { text: "Multiply by σ₁/2 = 4/2 = 2: the rank-one matrix A₁ = [[2, 2], [2, 2]] (tinted by value).", rows: [[2, 2], [2, 2]] },
  });
}

/* ---------------- geometry: unit circle -> V^T -> Sigma -> U ---------------- */
function drawGeometry() {
  const host = $("#w-geo-figs");
  if (!host) return;
  const r = Math.SQRT1_2;
  const Vt = [[r, r], [r, -r]], Sg = [[4, 0], [0, 2]], U = [[r, r], [r, -r]];
  const mv = (M, [x, y]) => [M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y];
  const stages = [
    { t: "x (unit circle)", f: (p) => p },
    { t: "Vᵀx: reflection", f: (p) => mv(Vt, p) },
    { t: "ΣVᵀx: stretch by 4 and 2", f: (p) => mv(Sg, mv(Vt, p)) },
    { t: "UΣVᵀx = Ax: reflection", f: (p) => mv(U, mv(Sg, mv(Vt, p))) },
  ];
  const S = 16, V = 76, P = ([x, y]) => `${(x * S).toFixed(2)},${(-y * S).toFixed(2)}`;
  for (const st of stages) {
    const pts = [];
    for (let t = 0; t <= 96; t++) { const a = (t / 96) * 2 * Math.PI; pts.push(P(st.f([Math.cos(a), Math.sin(a)]))); }
    const e1 = st.f([1, 0]), e2 = st.f([0, 1]);
    const fig = el("figure", { class: "wk-geo-fig" },
      svg("svg", { viewBox: `${-V} ${-V} ${2 * V} ${2 * V}`, role: "img", "aria-label": `${st.t}. The marked points e1 = (1,0) ends at (${e1.map((v) => v.toFixed(2)).join(", ")}) and e2 = (0,1) at (${e2.map((v) => v.toFixed(2)).join(", ")}).` },
        svg("line", { x1: -V, y1: 0, x2: V, y2: 0, stroke: "#d9d2c2" }), svg("line", { x1: 0, y1: -V, x2: 0, y2: V, stroke: "#d9d2c2" }),
        svg("polyline", { points: pts.join(" "), fill: "#e3eaf6", "fill-opacity": 0.6, stroke: "#1f4ea3", "stroke-width": 1.6 }),
        svg("line", { x1: 0, y1: 0, x2: e1[0] * S, y2: -e1[1] * S, stroke: "#1f4ea3", "stroke-width": 2.5 }),
        svg("circle", { cx: e1[0] * S, cy: -e1[1] * S, r: 3.5, fill: "#1f4ea3" }),
        svg("line", { x1: 0, y1: 0, x2: e2[0] * S, y2: -e2[1] * S, stroke: "#1c1e23", "stroke-width": 2.5 }),
        svg("circle", { cx: e2[0] * S, cy: -e2[1] * S, r: 3.5, fill: "#1c1e23" })),
      el("figcaption", { text: st.t }));
    host.append(fig);
  }
  host.append(el("p", { class: "lj-mcap wk-geo-key", text: "Blue marker: e₁ = (1, 0). Black marker: e₂ = (0, 1). Orthogonal maps keep lengths and angles; only Σ changes the shape." }));
}

/* ---------------- engine check ---------------- */
const close = (a, b, t = 1e-9) => Math.abs(a - b) <= t;
const r6 = (x) => String(+x.toFixed(6));
const mat = (M, f = r6) => "[" + M.map((r) => "[" + r.map(f).join(", ") + "]").join(", ") + "]";

function setupEngine(root) {
  const btn = $("#w-check"), status = $("#w-engine-status"), table = $("#w-engine-table");
  let running = false;
  async function check() {
    if (running) return;
    running = true; btn.disabled = true;
    status.className = "wk-engine-status"; status.textContent = "Asking the engine…";
    try {
      const w = await api("/api/worked-example");
      const ok = close(w.sigma[0], 4) && close(w.sigma[1], 2) && close(w.energy_rank1, 0.8) && close(w.residual_frobenius, 2) &&
        w.A1.every((r, i) => r.every((v, j) => close(v, 2))) && w.AtA.every((r, i) => r.every((v, j) => close(v, [[10, 6], [6, 10]][i][j]))) &&
        close(w.eigenvalues[0], 16) && close(w.eigenvalues[1], 4);
      status.className = "wk-engine-status " + (ok ? "is-ok" : "is-diff");
      status.textContent = ok
        ? `the package's own SVD agrees: σ = (${r6(w.sigma[0])}, ${r6(w.sigma[1])}), E(1) = ${r6(w.energy_rank1)}, ||A − A₁||F = ${r6(w.residual_frobenius)}.`
        : "The engine's numbers differ from the hand calculation by more than 1e-9; see the table.";
      const rows = [
        ["σ₁, σ₂", "4, 2", `${r6(w.sigma[0])}, ${r6(w.sigma[1])}`],
        ["λ₁, λ₂ (eigenvalues of AᵀA)", "16, 4", `${r6(w.eigenvalues[0])}, ${r6(w.eigenvalues[1])}`],
        ["AᵀA", "[[10, 6], [6, 10]]", mat(w.AtA)],
        ["U (first row positive)", "1/√2 · [[1, 1], [1, −1]] = [[0.707107, 0.707107], [0.707107, −0.707107]]", mat(w.U)],
        ["Vᵀ", "[[0.707107, 0.707107], [0.707107, −0.707107]]", mat(w.Vt)],
        ["A₁", "[[2, 2], [2, 2]]", mat(w.A1)],
        ["A − A₁", "[[1, −1], [−1, 1]]", mat(w.residual)],
        ["||A − A₁||F", "2", r6(w.residual_frobenius)],
        ["E(1)", "0.8", r6(w.energy_rank1)],
        ["largest entry of |A₁ + A₂ − A| (rounding)", "0", Number(w.reconstruction_error).toExponential(1)],
        ["stored values k(m+n+1), k = 1 (vs 4)", "5", String(w.stored_values_rank1)],
      ];
      const tb = table.querySelector("tbody");
      tb.replaceChildren(...rows.map(([q, a, b]) => el("tr", {}, el("th", { scope: "row", text: q }), el("td", { class: "mono", text: a.replace(/-/g, "−") }), el("td", { class: "mono", text: b.replace(/-/g, "−") }))));
      table.hidden = false;
    } catch {
      status.className = "wk-engine-status";
      status.textContent = "The engine could not be reached just now. The hand calculation above stands on its own; try the check again later.";
    } finally { running = false; btn.disabled = false; }
  }
  btn.addEventListener("click", check);
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); check(); } }, { threshold: 0.1 });
  io.observe($("#w-engine"));
}
