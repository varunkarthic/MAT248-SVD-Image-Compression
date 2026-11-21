/* Step-by-step matrix product L x R: highlights a row of L and a column of R, writes out the dot product,
 * and fills one entry of the result per step. Every calculation line is always visible (muted until reached),
 * so the widget is fully readable without animation. */
import { el, reducedMotion } from "../core.js";
import { matrixEl, setCls, minus } from "./ui.js";

export function mountMul(host, { L, R, final = null, tint = false, tilt = true, leftName = "A", rightName = "B", outName = "C", testid = "mul" }) {
  const p = L[0].length, rows = L.length, cols = R[0].length, total = rows * cols;
  const C = L.map((r, i) => R[0].map((_, j) => r.reduce((s, v, k) => s + v * R[k][j], 0)));
  const entries = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) entries.push([i, j]);
  const calc = (i, j) => {
    const wrap = (x) => (x < 0 ? `(${minus(x)})` : String(x));
    const terms = L[i].map((v, k) => `${wrap(v)}·${wrap(R[k][j])}`);
    return `${outName}(${i + 1},${j + 1}) = row ${i + 1} \u00b7 column ${j + 1} = ${terms.join(" + ")} = ${minus(C[i][j])}`;
  };

  const Lm = matrixEl(L, { label: `${leftName}, left matrix`, tint: false });
  const Rm = matrixEl(R, { label: `${rightName}, right matrix` });
  const Cm = matrixEl(C.map((r) => r.map(() => "?")), { label: `${outName}, the product`, cls: "lj-m--out" });
  const sym = (t) => el("span", { class: "lj-op", "aria-hidden": "true", text: t });
  const stage = el("div", { class: "lj-mul-stage" + (tilt && !reducedMotion() ? " is-tilt" : "") },
    el("div", { class: "lj-mul-plane" },
      el("figure", { class: "lj-mfig" }, Lm.root, el("figcaption", { text: leftName })), sym("\u00d7"),
      el("figure", { class: "lj-mfig" }, Rm.root, el("figcaption", { text: rightName })), sym("="),
      el("figure", { class: "lj-mfig" }, Cm.root, el("figcaption", { text: outName }))));
  const status = el("p", { class: "lj-mul-now", "aria-live": "polite", "data-testid": `${testid}-now` });
  const list = el("ol", { class: "lj-mul-list" }, entries.map(([i, j]) => el("li", { class: "mono", text: calc(i, j) })));
  const finalBox = el("div", { class: "lj-mul-final", hidden: true });
  if (final) {
    const fm = matrixEl(final.rows, { tint, label: "result after the scale factor" });
    finalBox.append(el("p", { text: final.text }), fm.root);
  }

  let s = 0, timer = null;
  const back = el("button", { class: "btn", type: "button", "data-testid": `${testid}-back`, text: "Back" });
  const next = el("button", { class: "btn btn--primary", type: "button", "data-testid": `${testid}-next`, text: "Next" });
  const play = el("button", { class: "btn", type: "button", "data-testid": `${testid}-play`, text: "Auto-play", "aria-pressed": "false" });
  const reset = el("button", { class: "btn", type: "button", "data-testid": `${testid}-reset`, text: "Reset" });
  const tiltBtn = el("button", { class: "btn btn--quiet", type: "button", "aria-pressed": String(tilt && !reducedMotion()), text: "3D tilt" });

  function render() {
    const cur = s > 0 ? entries[s - 1] : null;
    setCls(Lm.cells, (i) => cur && i === cur[0], "hl");
    setCls(Rm.cells, (_, j) => cur && j === cur[1], "hl2");
    Cm.cells.forEach((row, i) => row.forEach((c, j) => {
      const idx = i * cols + j;
      const done = idx < s;
      c.textContent = done ? minus(C[i][j]) : "?";
      c.classList.toggle("hl", cur && cur[0] === i && cur[1] === j);
      c.classList.toggle("pending", !done);
    }));
    [...list.children].forEach((li, idx) => {
      li.classList.toggle("is-done", idx < s);
      li.classList.toggle("is-now", idx === s - 1);
    });
    status.textContent = cur ? calc(cur[0], cur[1]) + "." : `Press Next to fill ${outName}(1,1) using row 1 of ${leftName} and column 1 of ${rightName}.`;
    if (s >= total) status.textContent = `All ${total} entries filled. ` + (cur ? calc(cur[0], cur[1]) + "." : "");
    back.disabled = s === 0;
    next.disabled = s >= total;
    finalBox.hidden = !(final && s >= total);
    if (s >= total) stop();
  }
  function stop() { if (timer) { clearTimeout(timer); timer = null; } play.setAttribute("aria-pressed", "false"); play.textContent = "Auto-play"; }
  function tick() {
    if (!host.isConnected) { stop(); return; }
    if (!document.hidden && s < total) { s++; render(); }
    if (s < total && timer !== null) timer = setTimeout(tick, 1500); else stop();
  }
  next.addEventListener("click", () => { stop(); if (s < total) s++; render(); });
  back.addEventListener("click", () => { stop(); if (s > 0) s--; render(); });
  reset.addEventListener("click", () => { stop(); s = 0; render(); });
  play.addEventListener("click", () => {
    if (timer) { stop(); return; }
    if (s >= total) s = 0;
    render();
    play.setAttribute("aria-pressed", "true"); play.textContent = "Pause";
    timer = setTimeout(tick, 900);
  });
  tiltBtn.addEventListener("click", () => {
    const on = tiltBtn.getAttribute("aria-pressed") !== "true";
    tiltBtn.setAttribute("aria-pressed", String(on));
    stage.classList.toggle("is-tilt", on);
  });
  host.replaceChildren(stage,
    el("div", { class: "lj-ctrl", role: "group", "aria-label": "Step controls" }, back, next, play, reset, tiltBtn),
    status, list, finalBox);
  render();
  return { get step() { return s; }, total };
}
