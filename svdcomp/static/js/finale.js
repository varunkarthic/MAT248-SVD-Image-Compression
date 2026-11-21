/* Final reveal: five stations (original -> matrix -> SVD -> rank-k -> reconstruction).
 * Real numbers come from state / lab:* events; without a decomposed image the bundled sample is shown
 * and stations 3-5 say plainly that nothing has been computed. Nothing here is faked. */
import { $, $$, el, on, state, reducedMotion, int, num, pct } from "./core.js";
import { createPlayer } from "./anim/player.js";

const SAMPLE = "/samples/photo-gray.png";
const NAMES = ["Original image", "Matrix of numbers", "Singular value decomposition", "Rank-k approximation", "Reconstructed image"];
const DURATION = 5, STEP = 0.9;

export function init() {
  const root = $("#finale-stations"); if (!root) return;
  const playBtn = $("#finale-play"), status = $("#finale-status"), msg = $("#finale-message");
  const stations = $$(".fn-st", root);
  const reduced = reducedMotion();
  let spectrum = state.spectrum, recon = state.recon, info = state.info, matrixToken = 0;

  // ---- station 1 and 2: the original image and its top-left 6x6 gray values ----
  function showOriginal() {
    const src = info?.original || SAMPLE;
    const img = $("#fn-original");
    img.src = src;
    img.alt = info ? "Your original image" : "Bundled sample photograph (gray)";
    $("#fn-original-cap").textContent = info
      ? `Your image, ${info.width}×${info.height} pixels, ${info.channels === 1 ? "gray" : "colour"}.`
      : "Bundled sample photograph (demonstration). Nothing of yours has been loaded.";
    const mine = ++matrixToken, probe = new Image();
    probe.onload = () => {
      if (mine !== matrixToken) return;
      try {
        const c = document.createElement("canvas"); c.width = probe.naturalWidth; c.height = probe.naturalHeight;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(probe, 0, 0);
        const d = g.getImageData(0, 0, 6, 6).data, host = $("#fn-matrix"), vals = [];
        host.replaceChildren(); host.style.gridTemplateColumns = "repeat(6, auto)";
        for (let p = 0; p < 36; p++) {
          const v = Math.round(0.299 * d[4 * p] + 0.587 * d[4 * p + 1] + 0.114 * d[4 * p + 2]); vals.push(v);
          host.append(el("span", { "aria-hidden": "true", text: String(v) }));
        }
        host.setAttribute("aria-label", `Top-left 6 by 6 block of gray values: ${vals.join(", ")}`);
        $("#fn-matrix-cap").textContent = "Top-left 6×6 gray values (0 black, 255 white) read from the displayed PNG: the image really is this matrix.";
      } catch { $("#fn-matrix-cap").textContent = "The pixel values could not be read in this browser."; }
    };
    probe.onerror = () => { $("#fn-matrix-cap").textContent = "The image could not be loaded."; };
    probe.src = src;
  }

  // ---- station 3-5: real results only ----
  function showResults() {
    const svdCap = $("#fn-svd-cap"), rankCap = $("#fn-rank-cap"), rc = $("#fn-recon-cap"), img = $("#fn-recon"), empty = $("#fn-recon-empty");
    if (spectrum && info) {
      const s = (spectrum.sigma?.[0] || []).slice(0, 3).map((v, i) => `σ${i + 1} = ${num(v, 1)}`).join(", ");
      const [m, n] = spectrum.shape || [info.height, info.width];
      svdCap.textContent = `${m}×${n} matrix, ${spectrum.method || "exact"} method; ${s}, … (first channel, largest first).`;
    } else svdCap.textContent = "Not computed yet: nothing has been decomposed in the laboratory.";
    if (recon && info) {
      const mt = recon.metrics || {};
      rankCap.textContent = `k = ${recon.k}; keeps ${pct(mt.energy)} of the energy; relative error ${pct(mt.relative_error)}; ` +
        `${int(recon.stored_values)} numbers stored instead of ${int(recon.original_values)}.`;
      img.src = recon.image; img.alt = `Your image rebuilt from the first ${recon.k} singular components`; img.hidden = false; empty.hidden = true;
      rc.textContent = `Real reconstruction from /api/reconstruct, rank ${recon.k}.`;
      $("#fn-prompt").hidden = true;
    } else {
      rankCap.textContent = "Not computed yet: choose a rank in the laboratory.";
      img.hidden = true; img.removeAttribute("src"); img.alt = ""; empty.hidden = false;
      rc.textContent = "No reconstruction yet. We do not show a made-up one.";
      $("#fn-prompt").hidden = false;
    }
  }

  const render = () => { showOriginal(); showResults(); };
  on("lab:image", (d) => { info = state.info || d; spectrum = null; recon = null; render(); });
  on("lab:svd", (d) => { info = state.info || info; spectrum = d?.spectrum || state.spectrum; render(); });
  on("lab:rank", (d) => { info = state.info || info; recon = d?.recon || state.recon; if (!spectrum) spectrum = state.spectrum; render(); });
  render();

  // ---- the replayable sequence ----
  const frame = (t) => {
    const n = Math.min(5, Math.floor(t / STEP + 1e-6) + 1);
    stations.forEach((li, i) => li.classList.toggle("is-on", i < n));
    msg.classList.toggle("is-on", t >= DURATION - 0.4);
    status.textContent = t >= DURATION ? "Done: all five stations." : `Station ${n} of 5: ${NAMES[n - 1]}.`;
  };
  const player = createPlayer({
    duration: DURATION, onFrame: frame,
    onState: (s) => { playBtn.textContent = s === "playing" ? "Pause" : s === "ended" ? "Replay" : "Play"; },
  });
  const armed = $("#finale-stations").closest(".wrap");
  if (reduced) { player.stop(true); playBtn.textContent = "Play"; }
  else { armed.classList.add("fn-armed"); frame(0); player.stop(); }
  playBtn.addEventListener("click", () => {
    if (reduced) { player.stop(true); return; }
    armed.classList.add("fn-armed");
    if (player.state === "playing") player.pause();
    else { if (player.state === "ended") player.seek(0); player.play(); }
  });
  if (!reduced && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); if (player.state === "idle") player.play(); }
    }, { threshold: 0.35 });
    io.observe(root);
  }
}
