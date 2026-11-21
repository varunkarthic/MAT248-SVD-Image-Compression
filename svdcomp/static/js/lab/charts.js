/* Hand-drawn SVG charts for the laboratory. Everything plotted comes from the API response;
 * the browser only draws. Charts redraw at their real pixel width so fonts stay >= 13 px. */
import { el, svg, int } from "../core.js";

export const CHANNEL_COLORS = { 1: ["#1f4ea3"], 2: ["#1f4ea3", "#6b6f78"], 3: ["#8c2f39", "#2f7d5b", "#1f4ea3"], 4: ["#8c2f39", "#2f7d5b", "#1f4ea3", "#6b6f78"] };
const CHANNEL_NAMES = ["R", "G", "B", "A"];
const channelNames = (c) => (c === 1 ? ["gray"] : c === 2 ? ["gray", "alpha"] : CHANNEL_NAMES.slice(0, c));
const M = { l: 70, r: 18, t: 20, b: 52 };
const FS = 13;

/* ---------- scales ---------- */
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
export function linearScale(d0, d1, r0, r1, nTicks = 5) {
  if (d1 === d0) d1 = d0 + 1;
  const step = niceStep((d1 - d0) / nTicks);
  const ticks = [];
  for (let v = Math.ceil(d0 / step - 1e-9) * step; v <= d1 + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return { fn: (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0), ticks, log: false, d0, d1 };
}
export function logScale(d0, d1, r0, r1) {
  const l0 = Math.log10(d0), l1 = Math.log10(d1);
  const ticks = [];
  for (let e = Math.ceil(l0 - 1e-9); e <= Math.floor(l1 + 1e-9); e++) ticks.push(Math.pow(10, e));
  return { fn: (v) => r0 + ((Math.log10(Math.max(v, d0)) - l0) / (l1 - l0)) * (r1 - r0), ticks, log: true, d0, d1 };
}
/** Rank axis: linear for short spectra, logarithmic for long ones. */
function rankScale(N, r0, r1, forceLinear = false) {
  if (N < 2) return linearScale(0.5, 1.5, r0, r1, 1);
  if (forceLinear || N < 32) {
    const s = linearScale(1, N, r0, r1, 6);
    s.ticks = s.ticks.filter((t) => t >= 1 && Number.isInteger(t));
    return s;
  }
  const s = logScale(1, N, r0, r1);
  const extra = [2, 5, 20, 50, 200, 500, 2000, 5000].filter((t) => t < N);
  s.ticks = [...s.ticks, ...extra].sort((a, b) => a - b);
  if (s.ticks.length > 7) s.ticks = s.ticks.filter((t) => [1, 10, 100, 1000, 10000].includes(t));
  return s;
}
const fmtTick = (v) => {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-3) return v.toExponential(0).replace("e+", "e");
  if (a >= 1000) return int(Math.round(v));
  return String(+v.toPrecision(3));
};
const fmtNum = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "∞" : v >= 1000 ? int(Math.round(v)) : v.toFixed(d));

/* ---------- drawing helpers ---------- */
const line = (x1, y1, x2, y2, cls, extra = {}) => svg("line", { x1, y1, x2, y2, class: cls, ...extra });
const text = (x, y, s, cls = "ch-text", anchor = "middle", extra = {}) => svg("text", { x, y, class: cls, "text-anchor": anchor, "font-size": FS, text: s, ...extra });
const path = (d, attrs) => svg("path", { d, fill: "none", ...attrs });

function axes(P, xs, ys, { xLabel, yLabel, yFmt = fmtTick, xFmt = fmtTick, plotBottom = P.y1, showX = true, left = P.x0 }) {
  const g = svg("g");
  for (const t of ys.ticks) {
    const y = ys.fn(t);
    g.append(line(left, y, P.x1, y, "ch-grid"), text(left - 8, y + 4, yFmt(t), "ch-text", "end"));
  }
  g.append(line(left, plotBottom, P.x1, plotBottom, "ch-axis"), line(left, P.y0, left, plotBottom, "ch-axis"));
  if (showX) {
    for (const t of xs.ticks) {
      const x = xs.fn(t);
      g.append(line(x, plotBottom, x, plotBottom + 5, "ch-axis"), text(x, plotBottom + 20, xFmt(t)));
    }
    g.append(text((left + P.x1) / 2, plotBottom + 42, xLabel, "ch-lab"));
  }
  const cy = (P.y0 + plotBottom) / 2;
  g.append(text(16, cy, yLabel, "ch-lab", "middle", { transform: `rotate(-90 16 ${cy})` }));
  return g;
}

function legend(P, items, left, y = P.y0 + 6) {
  const g = svg("g");
  items.forEach((it, i) => {
    const yy = y + i * 19;
    g.append(it.marker === "dot"
      ? svg("circle", { cx: left + 5, cy: yy + 5, r: 4.5, fill: it.hollow ? "#fdfbf6" : it.color, stroke: it.color, "stroke-width": 2 })
      : svg("rect", { x: left, y: yy, width: 11, height: 11, fill: it.color }));
    g.append(text(left + 18, yy + 11, it.label, "ch-text", "start"));
  });
  return g;
}

function markerLine(P, x, label, anchor = "start") {
  const g = svg("g");
  g.append(line(x, P.y0, x, P.y1, "ch-k"));
  if (label) g.append(text(x + (anchor === "start" ? 6 : -6), P.y0 + 12, label, "ch-klabel", anchor));
  return g;
}

/** Shared chart shell: title, svg area, caption, data table. Returns a controller. */
function shell(host, { fig, title, height, caption, table }) {
  const wrap = el("div", { class: "ch-wrap" });
  const cap = el("p", { class: "ch-cap muted", text: caption });
  const dtl = el("details", { class: "ch-table secondary" }, el("summary", { text: "Data table" }));
  const tableHost = el("div", { class: "ch-table-body" });
  dtl.append(tableHost);
  host.replaceChildren(el("p", { class: "lab-fig" }, el("strong", { text: fig }), ` ${title}`), wrap, cap, dtl);
  return { wrap, cap, tableHost, height, table };
}
function fillTable(tableHost, headers, rows) {
  const t = el("table", {}, el("thead", {}, el("tr", {}, headers.map((h) => el("th", { scope: "col", text: h })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c) => el("td", { class: "mono", text: String(c) }))))));
  tableHost.replaceChildren(t);
}
const sampleIdx = (N, maxRows = 40) => {
  if (N <= maxRows) return Array.from({ length: N }, (_, i) => i);
  const s = new Set([0, N - 1]);
  for (let j = 0; j < maxRows; j++) s.add(Math.round(Math.pow(N - 1, j / (maxRows - 1))) - 1 < 0 ? 0 : Math.round(Math.pow(N - 1, j / (maxRows - 1))));
  return [...s].sort((a, b) => a - b);
};

function makeChart(host, opts) {
  const sh = shell(host, opts);
  let data = null, k = 1, width = 0, P = null;
  const svgRoot = svg("svg", { role: "img", class: "ch-svg" });
  sh.wrap.append(svgRoot);
  function draw() {
    width = Math.max(260, Math.floor(sh.wrap.clientWidth || host.clientWidth || 600));
    const H = opts.height;
    svgRoot.replaceChildren();
    svgRoot.setAttribute("viewBox", `0 0 ${width} ${H}`);
    svgRoot.setAttribute("width", width);
    svgRoot.setAttribute("height", H);
    P = { x0: M.l, x1: width - M.r, y0: opts.top ?? M.t, y1: H - M.b, W: width, H, dyn: svg("g") };
    if (!data) {
      svgRoot.setAttribute("aria-label", `${opts.title}: no data yet`);
      svgRoot.append(text(width / 2, H / 2, opts.empty || "Compute the SVD to draw this chart.", "ch-text"));
      return;
    }
    P.static = svg("g");
    svgRoot.append(P.static, P.dyn);
    opts.draw(P, data, svgRoot);
    dyn();
  }
  function dyn() {
    if (!data || !P) return;
    P.dyn.replaceChildren();
    const label = opts.dyn(P, data, k);
    if (label) svgRoot.setAttribute("aria-label", `${opts.title}. ${label}`);
  }
  let lastW = 0, raf = 0;
  new ResizeObserver(() => {
    const w = Math.floor(sh.wrap.clientWidth);
    if (Math.abs(w - lastW) < 3) return;
    lastW = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }).observe(sh.wrap);
  draw();
  return {
    setData(d) { data = d; if (d && opts.table) { const t = opts.table(d); fillTable(sh.tableHost, t.headers, t.rows); } else sh.tableHost.replaceChildren(); if (d && opts.caption2) sh.cap.textContent = opts.caption2(d); draw(); },
    setK(v) { k = v; dyn(); },
    redraw: draw,
    cap: sh.cap,
  };
}

/* ---------- 1. singular values ---------- */
function sigmaChart(host) {
  return makeChart(host, {
    fig: "Fig. 3", title: "Singular values σᵢ (log scale)", height: 320,
    caption: "Singular values, largest first, on a logarithmic axis. Components up to the displayed k are coloured; the rest are grey.",
    draw(P, d) {
      const C = d.sigma.length, N = d.sigma[0].length;
      const all = d.sigma.flat();
      const pos = all.filter((v) => v > 0);
      const top = pos.length ? Math.max(...pos) : 1, bot = pos.length ? Math.min(...pos) : 0.1;
      let lo = Math.floor(Math.log10(bot)), hi = Math.ceil(Math.log10(top * 1.0001));
      if (hi <= lo) hi = lo + 1;
      if (hi - lo > 12) lo = hi - 12;
      d._ys = logScale(Math.pow(10, lo), Math.pow(10, hi), P.y1, P.y0);
      d._xs = N < 2 ? linearScale(0.5, 1.5, P.x0, P.x1, 1) : (() => { const s = linearScale(0.5, N + 0.5, P.x0, P.x1, 6); s.ticks = s.ticks.filter((t) => t >= 1 && Number.isInteger(t)); if (N >= 32) { const l = rankScale(N, P.x0, P.x1); const f = l.fn; l.fn = (v) => f(Math.max(v, 1)); return l; } return s; })();
      P.static.append(axes(P, d._xs, d._ys, { xLabel: `component index i${N >= 32 ? " (log scale)" : ""}`, yLabel: "σᵢ (log scale)" }));
      if (!pos.length) P.static.append(text(P.x1 - 8, P.y0 + 40, "all singular values are zero (blank image)", "ch-text", "end"));
      if (C > 1) P.static.append(legend(P, channelNames(C).map((n, i) => ({ label: `${n} channel`, color: CHANNEL_COLORS[Math.min(C, 4)][i] })), P.x1 - 120));
    },
    dyn(P, d, k) {
      const C = d.sigma.length, N = d.sigma[0].length, kk = Math.min(k, N);
      const xs = d._xs, ys = d._ys, base = P.y1, cols = CHANNEL_COLORS[Math.min(C, 4)];
      const bw = Math.max(1.5, Math.min(14, ((P.x1 - P.x0) / Math.max(N, 1)) * 0.7));
      d.sigma.forEach((s, c) => {
        if (C === 1) {
          let on = "", off = "";
          s.forEach((v, i) => { const seg = `M${xs.fn(i + 1).toFixed(1)} ${base}V${ys.fn(v > 0 ? v : 0).toFixed(1)}`; if (i < kk) on += seg; else off += seg; });
          if (off) P.dyn.append(path(off, { stroke: "#b9b4a6", "stroke-width": bw }));
          P.dyn.append(path(on, { stroke: cols[0], "stroke-width": bw }));
        } else {
          const pts = s.map((v, i) => [xs.fn(i + 1), ys.fn(v > 0 ? v : 0)]);
          P.dyn.append(path("M" + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L"), { stroke: "#cfcabb", "stroke-width": 1.5 }));
          P.dyn.append(path("M" + pts.slice(0, kk).map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L"), { stroke: cols[c], "stroke-width": 2.5 }));
          if (N <= 48) pts.forEach((p, i) => P.dyn.append(svg("circle", { cx: p[0], cy: p[1], r: 3, fill: i < kk ? cols[c] : "#cfcabb" })));
        }
      });
      const x = xs.fn(kk);
      P.dyn.append(markerLine(P, x, `k = ${kk}`, x > (P.x0 + P.x1) / 2 ? "end" : "start"));
      return `Singular values on a logarithmic axis, ${C} channel${C > 1 ? "s" : ""}, ${N} values. At k = ${kk} the largest is ${fmtNum(d.sigma[0][0], 1)} and σ at k is ${fmtNum(d.sigma[0][kk - 1], 2)}.`;
    },
    table: (d) => {
      const idx = sampleIdx(d.sigma[0].length);
      return { headers: ["i", ...channelNames(d.sigma.length).map((n) => `σᵢ ${n}`)], rows: idx.map((i) => [i + 1, ...d.sigma.map((s) => fmtNum(s[i], 3))]) };
    },
  });
}

/* ---------- 2. cumulative energy ---------- */
function energyChart(host) {
  return makeChart(host, {
    fig: "Fig. 4", title: "Retained energy E(k)", height: 320,
    caption: "Share of the squared Frobenius norm kept by the first k components: E(k) = Σ σᵢ² / Σ all σᵢ².",
    draw(P, d) {
      const N = d.energy.length;
      d._xs = rankScale(N, P.x0, P.x1);
      d._ys = linearScale(0, 100, P.y1, P.y0, 5);
      P.static.append(axes(P, d._xs, d._ys, { xLabel: `rank k${N >= 32 ? " (log scale)" : ""}`, yLabel: "retained energy (%)", yFmt: (v) => `${v}` }));
      const pts = d.energy.map((e, i) => `${d._xs.fn(i + 1).toFixed(1)} ${d._ys.fn(e * 100).toFixed(1)}`);
      P.static.append(path("M" + pts.join("L"), { stroke: "#b9b4a6", "stroke-width": 2 }));
      if (N === 1) P.static.append(svg("circle", { cx: d._xs.fn(1), cy: d._ys.fn(d.energy[0] * 100), r: 4, fill: "#b9b4a6" }));
    },
    dyn(P, d, k) {
      const N = d.energy.length, kk = Math.min(k, N), xs = d._xs, ys = d._ys;
      const pts = d.energy.slice(0, kk).map((e, i) => `${xs.fn(i + 1).toFixed(1)} ${ys.fn(e * 100).toFixed(1)}`);
      P.dyn.append(path(`M${xs.fn(1).toFixed(1)} ${P.y1}L` + pts.join("L") + `L${xs.fn(kk).toFixed(1)} ${P.y1}Z`, { fill: "rgba(31,78,163,.12)", stroke: "none" }));
      P.dyn.append(path("M" + pts.join("L"), { stroke: "#1f4ea3", "stroke-width": 2.5 }));
      const x = xs.fn(kk), y = ys.fn(d.energy[kk - 1] * 100);
      P.dyn.append(markerLine(P, x, null));
      P.dyn.append(svg("circle", { cx: x, cy: y, r: 5.5, class: "ch-dot" }));
      const lab = `k = ${kk}: E = ${(d.energy[kk - 1] * 100).toFixed(2)} %`;
      P.dyn.append(text(x > (P.x0 + P.x1) / 2 ? x - 10 : x + 10, Math.min(Math.max(y + 22, P.y0 + 28), P.y1 - 10), lab, "ch-klabel", x > (P.x0 + P.x1) / 2 ? "end" : "start"));
      return `Cumulative retained energy rising to ${(d.energy[N - 1] * 100).toFixed(2)} percent. At k = ${kk} it is ${(d.energy[kk - 1] * 100).toFixed(2)} percent.`;
    },
    table: (d) => ({ headers: ["k", "E(k) %"], rows: sampleIdx(d.energy.length).map((i) => [i + 1, (d.energy[i] * 100).toFixed(3)]) }),
  });
}

/* ---------- 3. error ---------- */
function errorChart(host) {
  const c = makeChart(host, {
    fig: "Fig. 5", title: "Approximation error vs rank", height: 380, top: 64,
    caption: "Frobenius error ‖A − A_k‖_F.",
    draw(P, d) {
      const N = d.spectral.length;
      const pix = d.pixels || [];
      const maxV = Math.max(...d.spectral, ...pix.map((p) => p.frobenius_error || 0), 1e-9) * 1.05;
      d._xs = rankScale(N, P.x0, P.x1);
      d._ys = linearScale(0, maxV, P.y1, P.y0, 5);
      P.static.append(axes(P, d._xs, d._ys, { xLabel: `rank k${N >= 32 ? " (log scale)" : ""}`, yLabel: "Frobenius error (pixel units)" }));
      const items = [{ label: d.exact ? "mathematical, before 8-bit rounding" : "estimate, before 8-bit rounding", color: "#1f4ea3" }];
      if (pix.length) items.push({ label: "measured, after 8-bit rounding", color: "#1c1e23", marker: "dot", hollow: true });
      const lg = legend(P, items, P.x0, 2);
      P.static.append(lg);
      const pts = d.spectral.map((e, i) => `${d._xs.fn(i + 1).toFixed(1)} ${d._ys.fn(e).toFixed(1)}`);
      P.static.append(path("M" + pts.join("L"), { stroke: "#1f4ea3", "stroke-width": 2.5, "stroke-dasharray": d.exact ? "" : "7 4" }));
      if (N === 1) P.static.append(svg("circle", { cx: d._xs.fn(1), cy: d._ys.fn(d.spectral[0]), r: 4, fill: "#1f4ea3" }));
      pix.forEach((p) => P.static.append(svg("circle", { cx: d._xs.fn(p.k), cy: d._ys.fn(p.frobenius_error), r: 4.5, fill: "#fdfbf6", stroke: "#1c1e23", "stroke-width": 2 })));
    },
    dyn(P, d, k) {
      const N = d.spectral.length, kk = Math.min(k, N), x = d._xs.fn(kk), y = d._ys.fn(d.spectral[kk - 1]);
      P.dyn.append(markerLine(P, x, null));
      P.dyn.append(svg("circle", { cx: x, cy: y, r: 5.5, class: "ch-dot" }));
      P.dyn.append(text(x > (P.x0 + P.x1) / 2 ? x - 10 : x + 10, Math.min(y + 24, P.y1 - 10), `k = ${kk}: ${fmtNum(d.spectral[kk - 1], 1)}`, "ch-klabel", x > (P.x0 + P.x1) / 2 ? "end" : "start"));
      return `Frobenius error falls from ${fmtNum(d.spectral[0], 1)} at k = 1 to ${fmtNum(d.spectral[N - 1], 1)} at k = ${N}. At k = ${kk} the ${d.exact ? "mathematical" : "estimated"} error is ${fmtNum(d.spectral[kk - 1], 1)}.`;
    },
    table: (d) => ({ headers: ["k", d.exact ? "spectral error (math)" : "spectral error (estimate)", "pixel error (8-bit)"],
      rows: sampleIdx(d.spectral.length).map((i) => [i + 1, fmtNum(d.spectral[i], 2), (d.pixels || []).find((p) => p.k === i + 1)?.frobenius_error?.toFixed(2) ?? "-"]) }),
    caption2: (d) => d.exact
      ? "Line: the exact error √(Σ σᵢ² for i > k) before rounding to 8-bit pixels (Eckart–Young). Circles: error measured on the actual 8-bit picture, always a little different."
      : "Dashed line: estimate from the computed leading singular values (randomized SVD). Circles: error measured on the actual 8-bit picture.",
  });
  return c;
}

/* ---------- 4. quality ---------- */
function qualityChart(host) {
  let status = "loading";
  const c = makeChart(host, {
    fig: "Fig. 6", title: "Measured quality: PSNR and SSIM", height: 440,
    caption: "Measured on the reconstructed 8-bit pictures at sampled ranks.",
    empty: "Compute the SVD to measure quality.",
    draw(P, d) {
      if (!d.points) {
        P.static.append(text((P.x0 + P.x1) / 2, P.H / 2, status === "error" ? `Measured curves unavailable: ${d.message}` : "Measuring quality at sampled ranks…", "ch-text"));
        return;
      }
      const pts = d.points, N = d.N;
      const xs = rankScale(N, P.x0, P.x1);
      const gap = 56, ph = (P.y1 - P.y0 - gap) / 2;
      const a0 = P.y0, a1 = P.y0 + ph, b0 = a1 + gap, b1 = P.y1;
      const fin = pts.map((p) => p.psnr).filter((v) => v !== null && Number.isFinite(v));
      const anyInf = pts.some((p) => p.psnr === null);
      let lo = fin.length ? Math.floor((Math.min(...fin) - 1) / 5) * 5 : 0, hi = fin.length ? Math.ceil((Math.max(...fin) + 1) / 5) * 5 : 10;
      if (anyInf) hi += 8;
      if (hi <= lo) hi = lo + 10;
      const yp = linearScale(lo, hi, a1, a0, 4);
      yp.ticks = yp.ticks.filter((t) => !anyInf || t < hi - 4);
      const ss = pts.map((p) => p.ssim).filter((v) => Number.isFinite(v));
      const sLo = Math.min(0, ...ss), ys = linearScale(sLo > -0.001 ? 0 : Math.floor(sLo * 10) / 10, 1, b1, b0, 4);
      P.static.append(axes({ ...P, y1: a1 }, xs, yp, { xLabel: "", yLabel: "PSNR (dB)", plotBottom: a1, showX: false }));
      P.static.append(axes({ ...P, y0: b0 }, xs, ys, { xLabel: `rank k${N >= 32 ? " (log scale)" : ""}`, yLabel: "SSIM (1 = identical)", plotBottom: b1 }));
      if (anyInf) P.static.append(text(P.x0 + 6, a0 + 14, "∞ = identical to the original", "ch-text", "start"));
      const yP = (p) => (p.psnr === null ? yp.fn(hi - 1) : yp.fn(p.psnr));
      P.static.append(path("M" + pts.filter((p) => p.psnr !== null).map((p) => `${xs.fn(p.k).toFixed(1)} ${yP(p).toFixed(1)}`).join("L"), { stroke: "#1f4ea3", "stroke-width": 2.5 }));
      pts.forEach((p) => {
        if (p.psnr === null) P.static.append(svg("path", { d: `M${xs.fn(p.k)} ${yP(p) - 6}l6 6l-6 6l-6 -6z`, fill: "#1f4ea3" }));
        else P.static.append(svg("circle", { cx: xs.fn(p.k), cy: yP(p), r: 4, fill: "#1f4ea3" }));
      });
      P.static.append(path("M" + pts.map((p) => `${xs.fn(p.k).toFixed(1)} ${ys.fn(p.ssim).toFixed(1)}`).join("L"), { stroke: "#2f7d5b", "stroke-width": 2.5 }));
      pts.forEach((p) => P.static.append(svg("circle", { cx: xs.fn(p.k), cy: ys.fn(p.ssim), r: 4, fill: "#2f7d5b" })));
      P.q = { xs, a0, a1, b0, b1, N };
    },
    dyn(P, d, k) {
      if (!d.points || !P.q) return d.points ? "" : "Quality curves are still being measured.";
      const x = P.q.xs.fn(Math.min(k, P.q.N));
      for (const [y0, y1] of [[P.q.a0, P.q.a1], [P.q.b0, P.q.b1]]) P.dyn.append(line(x, y0, x, y1, "ch-k"));
      P.dyn.append(text(x > (P.x0 + P.x1) / 2 ? x - 6 : x + 6, P.q.a1 + 16, `k = ${k}`, "ch-klabel", x > (P.x0 + P.x1) / 2 ? "end" : "start"));
      return `PSNR in decibels and SSIM measured at ${d.points.length} sampled ranks from 1 to ${P.q.N}. Displayed rank k = ${k}.`;
    },
    table: (d) => (d.points ? { headers: ["k", "PSNR dB", "SSIM"], rows: d.points.map((p) => [p.k, p.psnr === null ? "∞ (identical)" : p.psnr.toFixed(2), p.ssim.toFixed(4)]) } : { headers: ["k"], rows: [] }),
    caption2: (d) => (d.points ? `Measured at ${d.points.length} sampled ranks (after rounding to 8-bit pixels); rank k itself may fall between two samples.` : "Measuring quality at sampled ranks. This can take a few seconds."),
  });
  return {
    ...c,
    setCurves(points, N) { status = "ok"; c.setData({ points, N }); },
    setLoading() { status = "loading"; c.setData({ points: null }); },
    setError(message) { status = "error"; c.setData({ points: null, message }); },
    clear() { c.setData(null); },
  };
}

/* ---------- 5. storage ---------- */
function storageChart(host) {
  return makeChart(host, {
    fig: "Fig. 7", title: "Stored scalar count vs rank", height: 320,
    caption: "Scalar count k(m+n+1)·channels against the original m·n·channels. This is a count of numbers, not a file size.",
    draw(P, d) {
      const N = d.stored.length, orig = d.original;
      const maxV = Math.max(orig, d.stored[N - 1]) * 1.08;
      d._xs = rankScale(N, P.x0, P.x1, true);
      d._ys = linearScale(0, maxV, P.y1, P.y0, 5);
      P.static.append(axes(P, d._xs, d._ys, { xLabel: "rank k", yLabel: "stored scalars", yFmt: (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : String(v)) }));
      const yo = d._ys.fn(orig);
      P.static.append(line(P.x0, yo, P.x1, yo, "ch-orig"));
      P.static.append(text(P.x0 + 8, yo - 7, `original: m·n·channels = ${int(orig)}`, "ch-text", "start"));
      P.static.append(path("M" + d.stored.map((v, i) => `${d._xs.fn(i + 1).toFixed(1)} ${d._ys.fn(v).toFixed(1)}`).join("L"), { stroke: "#1f4ea3", "stroke-width": 2.5 }));
      const kc = (d.m * d.n) / (d.m + d.n + 1);
      if (kc >= 1 && kc <= N) {
        const x = d._xs.fn(kc);
        P.static.append(svg("circle", { cx: x, cy: yo, r: 5, fill: "#fdfbf6", stroke: "#1c1e23", "stroke-width": 2 }));
        P.static.append(text(x, P.y1 - 10, `crossover k ≈ ${kc.toFixed(1)}`, "ch-text", x > (P.x0 + P.x1) * 0.7 ? "end" : "start", { transform: `translate(${x > (P.x0 + P.x1) * 0.7 ? -8 : 8} 0)` }));
      } else if (kc > N) {
        P.static.append(text(P.x1 - 8, P.y1 - 10, `stays below the original for every available rank (crossover k ≈ ${kc.toFixed(1)})`, "ch-text", "end"));
      } else {
        P.static.append(text(P.x1 - 8, P.y1 - 10, `exceeds the original from k = 1 (crossover k ≈ ${kc.toFixed(2)})`, "ch-text", "end"));
      }
    },
    dyn(P, d, k) {
      const N = d.stored.length, kk = Math.min(k, N), x = d._xs.fn(kk), y = d._ys.fn(d.stored[kk - 1]);
      P.dyn.append(markerLine(P, x, null));
      P.dyn.append(svg("circle", { cx: x, cy: y, r: 5.5, class: "ch-dot" }));
      P.dyn.append(text(x > (P.x0 + P.x1) / 2 ? x - 10 : x + 10, Math.max(y - 10, P.y0 + 14), `k = ${kk}: ${int(d.stored[kk - 1])}`, "ch-klabel", x > (P.x0 + P.x1) / 2 ? "end" : "start"));
      return `Stored scalar count grows linearly to ${int(d.stored[N - 1])}; the original image has ${int(d.original)}. At k = ${kk}: ${int(d.stored[kk - 1])} scalars. Scalar count, not file size.`;
    },
    table: (d) => ({ headers: ["k", "stored scalars", "% of original"], rows: sampleIdx(d.stored.length).map((i) => [i + 1, int(d.stored[i]), (100 * d.stored[i] / d.original).toFixed(1)]) }),
  });
}

/** Build all five charts. */
export function createCharts(hosts) {
  const sigma = sigmaChart(hosts.sigma), energy = energyChart(hosts.energy), error = errorChart(hosts.error),
    quality = qualityChart(hosts.quality), storage = storageChart(hosts.storage);
  let spectrum = null, pixels = null;
  const errData = () => spectrum && { spectral: spectrum.curves.spectral_error, exact: spectrum.curves.exact, pixels };
  return {
    setSpectrum(sp) {
      spectrum = sp; pixels = null;
      if (!sp) { for (const c of [sigma, energy, error, storage]) c.setData(null); quality.clear(); return; }
      sigma.setData({ sigma: sp.sigma });
      energy.setData({ energy: sp.curves.energy });
      error.setData(errData());
      storage.setData({ stored: sp.curves.stored_values, original: sp.curves.original_values, m: sp.shape[0], n: sp.shape[1] });
      quality.setLoading();
    },
    setCurves(points) {
      pixels = points;
      if (!spectrum) return;
      error.setData(errData());
      quality.setCurves(points, spectrum.max_rank);
    },
    setCurvesError(msg) { quality.setError(msg); },
    setK(k) { for (const c of [sigma, energy, error, quality, storage]) c.setK(k); },
  };
}
