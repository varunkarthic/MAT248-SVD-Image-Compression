/* The laboratory: upload / sample -> SVD -> rank-k reconstruction -> compare -> numbers -> download.
 * The browser never computes mathematics; it requests discrete results from the Flask API and draws them.
 * Concurrency rules: every asynchronous result is checked against an image id, a decomposition id and
 * (for playback) a play-session counter, so stale responses can never overwrite newer state. */
import { $, $$, api, form, emit, on, state, config, reducedMotion, el, num, pct, int, bytes } from "./core.js";
import { prepareFile } from "./lab/upload.js";
import { initGallery } from "./lab/gallery.js";
import { createCompare } from "./lab/compare.js";
import { createCharts } from "./lab/charts.js";
import { drawHeatmap } from "./lab/blocks.js";

const MML = "http://www.w3.org/1998/Math/MathML";
const mml = (tag, txt, ...kids) => {
  const e = document.createElementNS(MML, tag);
  if (txt !== null && txt !== undefined) e.textContent = txt;
  for (const k of kids) e.append(k);
  return e;
};
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new DOMException("aborted", "AbortError"));
  const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); };
  signal.addEventListener("abort", onAbort, { once: true });
});
const isAbort = (e) => e && e.name === "AbortError";
/** Discrete ranks shown by the animation: every k at first, then roughly geometric steps, always ending at `target`. */
export function schedule(target) {
  const out = [];
  for (let d = 1; d <= target; d *= 10) {
    for (const m of d === 1 ? [1, 2, 3, 4, 5, 6, 8] : [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8]) {
      const k = Math.round(m * d);
      if (k <= target && !out.includes(k)) out.push(k);
    }
  }
  out.sort((a, b) => a - b);
  if (out[out.length - 1] !== target) out.push(target);
  return out;
}

export function init() {
  const root = $("#lab");
  if (!root) return;
  const q = (s) => $(s, root);

  /* ---------- elements ---------- */
  const fileInput = q("#file-input"), dropzone = q("#dropzone"), clearBtn = q("#btn-clear-file");
  const busyEl = q("#lab-busy"), errorEl = q("#lab-error"), metaEl = q("#image-meta"), notesEl = q("#image-notes");
  const analysis = q("#lab-analysis"), below = q("#lab-global-below");
  const methodSel = q("#method"), budgetField = q("#rank-budget-field"), budget = q("#rank-budget"), methodNote = q("#method-note");
  const runBtn = q("#run-svd"), svdStatus = q("#svd-status");
  const slider = q("#rank-slider"), rankInput = q("#rank-input"), rankOf = q("#rank-of");
  const btnPlay = q("#btn-play"), btnNext = q("#btn-next"), btnPrev = q("#btn-prev"), btnRestart = q("#btn-restart");
  const speedSel = q("#speed"), btnDownload = q("#btn-download"), btnReset = q("#btn-reset"), btnFull = q("#btn-fullscreen");
  const transport = q("#transport"), stage = q("#lab-stage"), stageStatus = q("#stage-status"), stageTitle = q("#stage-title");
  const sideChk = q("#side-by-side"), diffChk = q("#show-diff");
  const compChk = q("#show-component"), compView = q("#component-view"), compImg = q("#component-img"), compText = q("#component-text");
  const eqHost = q("#equation"), eqSigma = q("#equation-sigma"), eqWrap = q("#equation-wrap");
  const introBox = q("#intro-steps"), introItems = $$("#intro-list li", root), introSkip = q("#lab-explain-skip");
  const tabGlobal = q("#tab-global"), tabBlocks = q("#tab-blocks"), panelGlobal = q("#panel-global"), panelBlocks = q("#panel-blocks");
  const blockSize = q("#block-size"), blockEnergy = q("#block-energy"), blockEnergyOut = q("#block-energy-out");
  const runBlocksBtn = q("#run-blocks"), blocksStatus = q("#blocks-status"), blocksResultEl = q("#blocks-result"), blocksNote = q("#blocks-disabled");
  const blocksDl = q("#blocks-results"), heat = q("#heatmap");

  const compare = createCompare();
  const charts = createCharts({ sigma: q("#chart-sigma"), energy: q("#chart-energy"), error: q("#chart-error"), quality: q("#chart-quality"), storage: q("#chart-storage") });
  let gallery = { setActive() {} };

  /* ---------- state ---------- */
  let uploadSeq = 0, loadCtl = null;           // which load attempt is newest
  let imageId = 0;                              // identity of the image currently in the workspace
  let svdRun = 0, svdBusy = false, svdCtl = null, curvesCtl = null;
  let reconCtl = null, manualSeq = 0, compCtl = null, blocksCtl = null, blocksRun = 0;
  let playSession = 0, playCtl = null, playing = false, playTarget = null, resume = null;
  let info = null, spectrum = null, maxRank = 1, displayedK = null, curImage = null, blocksRes = null;
  let curMethod = "", lastLoad = null, introSkipped = false, introDone = false, tab = "global";
  const cache = new Map();
  const CACHE_MAX = 60;
  let announceTimer = 0;

  const stale = (id = imageId, run = svdRun) => id !== imageId || run !== svdRun;
  const clampK = (k) => Math.max(1, Math.min(maxRank, Math.round(k)));
  const diffOn = () => diffChk.checked;

  /* ---------- small UI helpers ---------- */
  function announce(text, delay = 0) {
    clearTimeout(announceTimer);
    if (!delay) { stageStatus.textContent = text; return; }
    announceTimer = setTimeout(() => { stageStatus.textContent = text; }, delay);
  }
  function setBusy(msg) { busyEl.textContent = msg; dropzone.setAttribute("aria-busy", String(Boolean(msg))); }
  function clearError() { errorEl.hidden = true; errorEl.replaceChildren(); }
  function showError(err, { reload = true } = {}) {
    const msg = err && err.message ? err.message : String(err);
    errorEl.replaceChildren(el("span", { text: msg }));
    if (reload && /expired|unknown image|unknown or expired/i.test(msg)) {
      const sample = info && info.source && info.source.sample;
      errorEl.append(" ", sample
        ? el("button", { type: "button", class: "btn btn--quiet", "data-testid": "btn-reload-sample", onclick: () => lastLoad && lastLoad.sample && loadSample(lastLoad.sample) }, "Reload sample")
        : el("span", { text: "Please choose the image again." }));
    }
    errorEl.hidden = false;
  }
  function syncEnabled() {
    const ready = Boolean(spectrum) && !svdBusy;
    transport.disabled = !ready;
    compChk.disabled = !ready;
    btnPrev.disabled = !ready || displayedK <= 1;
    btnNext.disabled = !ready || displayedK >= maxRank;
    btnDownload.disabled = !curImage;
    runBtn.disabled = svdBusy || !info;
  }
  function setPlayUi() {
    btnPlay.textContent = playing ? "Pause" : "Play";
    btnPlay.setAttribute("aria-pressed", String(playing));
    btnPlay.setAttribute("aria-label", playing ? "Pause the rank animation" : "Play the rank animation");
    stage.classList.toggle("is-playing", playing);
  }
  const sub = (k) => el("sub", { text: String(k) });

  /* ---------- cancellation ---------- */
  function cancelAll() {
    pause(false);
    for (const c of [svdCtl, curvesCtl, reconCtl, compCtl, blocksCtl]) c && c.abort();
    manualSeq++; clearTimeout(announceTimer);
  }

  /* ---------- loading an image ---------- */
  async function load(producer, meta) {
    const my = ++uploadSeq;
    loadCtl && loadCtl.abort();
    loadCtl = new AbortController();
    clearError();
    setBusy(meta.busy);
    try {
      const result = await producer(loadCtl.signal);
      if (my !== uploadSeq) return;
      lastLoad = meta;
      applyImage(result.data, result);
    } catch (err) {
      if (isAbort(err) || my !== uploadSeq) return;
      showError(err, { reload: false });
    } finally {
      if (my === uploadSeq) setBusy("");
    }
  }
  const loadSample = (s) => load(async (signal) => ({
    data: await api(`/api/sample/${encodeURIComponent(s.id)}`, { method: "POST", signal }), name: s.title, notes: [], sample: s,
  }), { sample: s, busy: `Loading “${s.title}”…` });

  async function loadFile(file) {
    clearBtn.hidden = false;
    await load(async (signal) => {
      const prep = await prepareFile(file, { maxBytes: config.maxUploadBytes, maxPixels: config.maxPixels });
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const data = await api("/api/upload", { method: "POST", body: form({ image: new File([prep.blob], prep.blob.name || "image.png", { type: prep.blob.type || "image/png" }), ...(prep.sourceFormat ? { source_format: prep.sourceFormat } : {}) }), signal });
      return { data, name: prep.name, notes: prep.notes, fileSize: prep.fileSize, inputLabel: prep.inputLabel };
    }, { busy: `Preparing “${file.name}”…`, file: true });
  }

  function applyImage(data, extra) {
    cancelAll();
    imageId++; svdRun++; svdBusy = false;
    spectrum = null; displayedK = null; curImage = null; blocksRes = null; resume = null; playTarget = null;
    cache.clear();
    info = data;
    Object.assign(state, { info: data, spectrum: null, method: null, k: 1, recon: null });
    charts.setSpectrum(null);
    compare.clear();
    compare.setOriginal(data.original, data.width, data.height, `Original image: ${extra.name}`);
    compare.setPos(50);
    compView.hidden = true; compChk.checked = false;
    diffChk.checked = false; sideChk.checked = false; compare.setSideBySide(false); compare.setDiff(null);
    for (const id of ["r-k", "r-dim", "r-energy", "r-frob", "r-spectral", "r-rel", "r-mse", "r-psnr", "r-ssim", "r-stored", "r-ratio", "r-source", "r-png"]) q(`#${id}`).textContent = "–";
    eqHost.replaceChildren(); eqSigma.replaceChildren();
    blocksResultEl.hidden = true; blocksStatus.textContent = "";
    introDone = false; introBox.hidden = true; introItems.forEach((li) => li.classList.remove("is-current"));
    renderMeta(data, extra);
    gallery.setActive(data.source && data.source.sample);
    stageTitle.textContent = "Original image";
    announce("Image loaded. Compute the SVD to rebuild it rank by rank.");
    svdStatus.textContent = "";
    configureMethod(data);
    configureBlocks(data);
    analysis.hidden = false;
    root.classList.add("is-loaded");
    clearBtn.hidden = false;
    setTab("global", false);
    setPlayUi(); syncEnabled();
    slider.max = rankInput.max = "1"; slider.value = rankInput.value = "1"; rankOf.textContent = "/ –";
    emit("lab:image", data);
    analysis.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function renderMeta(data, extra) {
    const c = data.channels;
    const chName = c === 1 ? "1 (gray)" : c === 2 ? "2 (gray + alpha)" : c === 3 ? "3 (RGB)" : c === 4 ? "4 (RGBA)" : String(c);
    const src = data.source || {};
    const fmt = String(src.format || extra.inputLabel || "png").toUpperCase();
    const rows = [
      ["Name", extra.name], ["Size", `${int(data.width)} × ${int(data.height)} pixels`], ["Channels", chName],
      ["Input format", extra.inputLabel && extra.inputLabel !== fmt ? extra.inputLabel : fmt],
      ["File size", bytes(extra.fileSize || src.bytes || 0)],
    ];
    metaEl.replaceChildren(...rows.map(([k, v]) => el("div", {}, el("dt", { text: k }), el("dd", { text: String(v) }))));
    metaEl.hidden = false;
    const notes = [...(extra.notes || [])];
    if (src.single_frame && !notes.some((n) => /first frame/.test(n))) notes.push("only the first frame is used");
    if (src.converted_in_browser && !notes.length) notes.push(`converted from ${fmt} to PNG in your browser before the SVD`);
    notesEl.textContent = notes.length ? `Note: ${notes.join("; ")}.` : "";
    notesEl.hidden = !notes.length;
  }

  function configureMethod(data) {
    const exactOpt = methodSel.querySelector('option[value="exact"]');
    const px = data.width * data.height, minDim = Math.min(data.width, data.height);
    exactOpt.disabled = !data.exact_allowed;
    methodNote.textContent = data.exact_allowed
      ? "Exact computes the whole spectrum with a Jacobi SVD (slow for large images). Randomized finds only the leading triplets, quickly."
      : `Exact is disabled: it is limited to ${int(config.maxExactPixels)} pixels and this image has ${int(px)}. Randomized computes the leading triplets only.`;
    methodSel.value = data.exact_allowed && px <= 16384 ? "exact" : "randomized";
    budget.max = String(minDim); budget.value = String(Math.min(config.defaultRank, minDim));
    budgetField.hidden = methodSel.value !== "randomized";
  }
  function configureBlocks(data) {
    runBlocksBtn.disabled = !data.blocks_allowed;
    blocksNote.hidden = data.blocks_allowed;
    if (!data.blocks_allowed) blocksNote.textContent = `Adaptive blocks are limited to ${int(config.maxBlockPixels)} pixels; this image has ${int(data.width * data.height)}.`;
  }
  methodSel.addEventListener("change", () => { budgetField.hidden = methodSel.value !== "randomized"; });

  /* ---------- computing the SVD ---------- */
  async function runSvd() {
    if (svdBusy || !info) return;
    pause(false);
    const id = imageId, run = ++svdRun;
    svdBusy = true; syncEnabled();
    clearError();
    svdCtl && svdCtl.abort(); reconCtl && reconCtl.abort(); curvesCtl && curvesCtl.abort(); compCtl && compCtl.abort();
    svdCtl = new AbortController();
    const signal = svdCtl.signal;
    const method = methodSel.value;
    curMethod = method;
    svdStatus.textContent = "Computing SVD…";
    try {
      const body = { token: info.token, method };
      if (method === "randomized") body.rank = Math.max(1, Math.min(+budget.value || 1, Math.min(info.width, info.height)));
      const sp = await api("/api/decompose", { method: "POST", body: form(body), signal });
      if (stale(id, run)) return;
      svdStatus.textContent = "Reconstructing ranks…";
      cache.clear(); resume = null; playTarget = null;
      maxRank = sp.max_rank;
      const k0 = Math.max(1, Math.min(maxRank, sp.suggested_k || 1));
      const recon = await fetchRecon(k0, signal, id, run);
      if (stale(id, run)) return;
      spectrum = sp;
      Object.assign(state, { spectrum: sp, method });
      slider.max = rankInput.max = String(maxRank); rankOf.textContent = `/ ${int(maxRank)}`;
      charts.setSpectrum(sp);
      renderIntro();
      emit("lab:svd", { spectrum: sp, method });
      compChk.disabled = false;
      const ok = await display(k0, recon, () => stale(id, run));
      if (!ok) return;
      svdStatus.textContent = `Done: ${method === "exact" ? "exact Jacobi SVD" : "randomized SVD"}, ${int(maxRank)} singular values per channel.`;
      announce(`SVD ready. Showing rank ${k0} of ${maxRank}. Press Play to build the image rank by rank.`);
      loadCurves(id, run);
    } catch (err) {
      if (isAbort(err) || stale(id, run)) return;
      svdStatus.textContent = "";
      showError(err);
    } finally {
      if (run === svdRun) { svdBusy = false; syncEnabled(); if (spectrum && !stale(id, run)) { /* keep */ } }
    }
  }
  runBtn.addEventListener("click", runSvd);

  function loadCurves(id, run) {
    curvesCtl && curvesCtl.abort();
    curvesCtl = new AbortController();
    const signal = curvesCtl.signal;
    api(`/api/curves?token=${encodeURIComponent(info.token)}&points=24`, { signal })
      .then((r) => { if (!stale(id, run)) charts.setCurves(r.points); })
      .catch((err) => { if (!isAbort(err) && !stale(id, run)) charts.setCurvesError(err.message); });
  }

  /* ---------- reconstructions (cached, one request at a time per consumer) ---------- */
  async function fetchRecon(k, signal, id = imageId, run = svdRun) {
    const key = `${info.token}|${curMethod}|${run}|${k}`;
    const hit = cache.get(key);
    const needDiff = diffOn();
    if (hit && (!needDiff || hit.difference)) { cache.delete(key); cache.set(key, hit); return hit; }
    const r = await api(`/api/reconstruct?token=${encodeURIComponent(info.token)}&k=${k}${needDiff ? "&diff=1" : ""}`, { signal });
    if (stale(id, run)) return r;
    cache.set(key, r);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return r;
  }

  /** Put rank k on screen: image, readout, equation, charts, results, all at once. Returns false when stale. */
  async function display(k, recon, isStale) {
    const im = new Image();
    im.src = recon.image;
    try { await im.decode(); } catch { /* the <img> below reports a broken image */ }
    if (isStale()) return false;
    displayedK = k;
    compare.setRecon(recon.image, `Rank ${k} reconstruction`);
    compare.setTag(`Rank ${k}`);
    stageTitle.textContent = `Rank ${k} of ${maxRank} reconstruction`;
    if (diffOn() && recon.difference) compare.setDiff(recon.difference, `Absolute pixel error, scaled to max ${num(recon.difference_max, 1)} (of 255). Darker means closer to the original.`);
    else compare.setDiff(null);
    slider.value = String(k); rankInput.value = String(k);
    writeResults(k, recon);
    writeEquation(k);
    charts.setK(k);
    curImage = { src: recon.image, name: `svdlab-rank-${k}.png` };
    Object.assign(state, { k, recon });
    syncEnabled();
    emit("lab:rank", { k, recon });
    if (!playing) refreshComponent();
    return true;
  }

  function writeResults(k, r) {
    const m = r.metrics || {}, c = spectrum.sigma.length;
    const [mm, nn] = spectrum.shape;
    const set = (id, v) => { q(`#${id}`).textContent = v; };
    set("r-k", String(k));
    set("r-dim", `${int(info.width)} × ${int(info.height)} px, ${c} channel${c > 1 ? "s" : ""}`);
    set("r-energy", pct(m.energy ?? spectrum.energy[k - 1], 3));
    set("r-frob", num(m.frobenius_error, 2));
    set("r-spectral", num(r.spectral_error, 2));
    q("#r-spec-kind").textContent = spectrum.curves.exact ? "(mathematical, before rounding)" : "(estimate, randomized)";
    set("r-rel", pct(m.relative_error, 3));
    set("r-mse", num(m.mse, 3));
    set("r-psnr", m.psnr === null || m.psnr === undefined ? "∞ dB (identical)" : `${num(m.psnr, 2)} dB`);
    set("r-ssim", num(m.ssim, 4));
    set("r-stored", `${int(r.stored_values)} = ${k}·(${mm}+${nn}+1)·${c}`);
    set("r-ratio", `${num(r.ratio, 2)}× (${(100 * r.stored_values / r.original_values).toFixed(1)} % of ${int(r.original_values)} original scalars)`);
    const src = info.source || {};
    set("r-source", `${bytes(src.bytes || 0)} (${String(src.format || "png").toUpperCase()})`);
    set("r-png", bytes(r.png_bytes));
  }

  function writeEquation(k) {
    const sig = spectrum.sigma.map((s) => s[k - 1]);
    const sum = mml("munderover", null, mml("mo", "∑"), mml("mrow", null, mml("mi", "i"), mml("mo", "="), mml("mn", "1")), mml("mn", String(k)));
    const math = mml("math", null, mml("mrow", null,
      mml("msub", null, mml("mi", "A"), mml("mn", String(k))), mml("mo", "="), sum,
      mml("msub", null, mml("mi", "σ"), mml("mi", "i")), mml("msub", null, mml("mi", "u"), mml("mi", "i")),
      mml("msubsup", null, mml("mi", "v"), mml("mi", "i"), mml("mi", "T"))));
    math.setAttribute("display", "block");
    eqHost.replaceChildren(math);
    const names = sig.length === 1 ? [""] : sig.length === 3 ? [" (R)", " (G)", " (B)"] : sig.map((_, i) => ` (ch ${i + 1})`);
    eqSigma.replaceChildren("σ", sub(k), ` = ${sig.map((s, i) => `${num(s, 2)}${names[i]}`).join(", ")}`,
      sig.length > 1 ? "  · the sum is applied to each colour channel" : "");
  }

  /* ---------- component view ---------- */
  async function refreshComponent() {
    compView.hidden = !compChk.checked;
    if (!compChk.checked || !spectrum || displayedK === null) return;
    const id = imageId, run = svdRun, i = displayedK;
    compCtl && compCtl.abort(); compCtl = new AbortController();
    try {
      const r = await api(`/api/component?token=${encodeURIComponent(info.token)}&i=${i}`, { signal: compCtl.signal });
      if (stale(id, run) || i !== displayedK) return;
      compImg.src = r.image; compImg.alt = `Signed rank-one component number ${i}: positive values vermilion, negative cobalt`;
      q("#comp-min").textContent = `−${num(r.vmax, 1)}`; q("#comp-max").textContent = `+${num(r.vmax, 1)}`;
      const sig = r.sigma.length === 3 ? r.sigma.map((s, j) => `${num(s, 2)} (${"RGB"[j]})`).join(", ") : r.sigma.map((s) => num(s, 2)).join(", ");
      compText.textContent = `Component i = ${i}: σ${i} = ${sig}. Share of total energy: ${pct(r.energy_share, 3)}. Cumulative energy of components 1 to ${i}: ${pct(r.energy_cumulative, 3)}.`;
    } catch (err) {
      if (!isAbort(err) && !stale(id, run)) compText.textContent = `Could not load the component: ${err.message}`;
    }
  }
  compChk.addEventListener("change", refreshComponent);

  /* ---------- manual rank changes ---------- */
  async function goTo(k, { force = false, quiet = false } = {}) {
    if (!spectrum) return;
    k = clampK(k);
    pause(false); resume = null;
    slider.value = String(k); rankInput.value = String(k);
    if (k === displayedK && !force) return;
    reconCtl && reconCtl.abort(); reconCtl = new AbortController();
    const my = ++manualSeq, id = imageId, run = svdRun, signal = reconCtl.signal;
    try {
      const r = await fetchRecon(k, signal, id, run);
      if (my !== manualSeq || stale(id, run)) return;
      const ok = await display(k, r, () => my !== manualSeq || stale(id, run));
      if (ok && !quiet) announce(`Rank ${k}: ${pct(r.metrics.energy, 2)} of the energy retained, PSNR ${r.metrics.psnr === null ? "infinite" : num(r.metrics.psnr, 1) + " dB"}.`, 450);
    } catch (err) {
      if (!isAbort(err) && my === manualSeq && !stale(id, run)) showError(err);
    }
  }
  let sliderTimer = 0;
  slider.addEventListener("input", () => {
    rankInput.value = slider.value;
    clearTimeout(sliderTimer);
    sliderTimer = setTimeout(() => goTo(+slider.value), 40);
  });
  let inputTimer = 0;
  rankInput.addEventListener("input", () => {
    clearTimeout(inputTimer);
    const v = rankInput.value.trim();
    if (!/^\d+$/.test(v)) return;
    inputTimer = setTimeout(() => { if (+v >= 1 && +v <= maxRank) goTo(+v); }, 350);
  });
  rankInput.addEventListener("change", () => {
    clearTimeout(inputTimer);
    const raw = Number(rankInput.value);
    if (!Number.isFinite(raw) || rankInput.value.trim() === "") { rankInput.value = String(displayedK ?? 1); announce(`Please enter a whole number from 1 to ${maxRank}.`); return; }
    const k = clampK(raw);
    if (k !== raw) announce(`Rank must be a whole number between 1 and ${maxRank}; using ${k}.`);
    goTo(k);
  });
  btnNext.addEventListener("click", () => goTo((displayedK ?? 1) + 1));
  btnPrev.addEventListener("click", () => goTo((displayedK ?? 1) - 1));

  /* ---------- playback ---------- */
  const dwell = () => {
    const ms = 2000 / (+speedSel.value || 1);
    return reducedMotion() ? Math.max(1200, ms) : ms;
  };
  function pause(say = true) {
    if (!playing) return;
    playSession++;
    playCtl && playCtl.abort();
    playing = false;
    resume = { pos: displayedK, target: playTarget };
    setPlayUi();
    if (say && displayedK) announce(`Paused at rank ${displayedK}.`);
    refreshComponent();
  }
  async function play(opts = {}) {
    if (!spectrum || playing || svdBusy) return;
    reconCtl && reconCtl.abort(); manualSeq++;
    const sess = ++playSession, ctl = (playCtl = new AbortController()), id = imageId, run = svdRun;
    const dead = () => sess !== playSession || stale(id, run);
    playing = true; setPlayUi(); clearError();
    const cur = clampK(Number(rankInput.value) || 1);
    let target, seq;
    if (opts.target) { target = clampK(opts.target); seq = schedule(target); }
    else if (resume && resume.pos === displayedK && resume.target > displayedK && cur === displayedK) {
      target = resume.target; seq = schedule(target).filter((k) => k > displayedK);
    } else {
      // Nothing to build up to at rank 1: aim for the rank that keeps 99.99 % of the energy (capped for speed).
      target = cur > 1 ? cur : clampK(Math.min(spectrum.suggested_k || 1, 60));
      seq = schedule(target);
    }
    playTarget = target; resume = null;
    announce(`Playing: building the image up to rank ${target}.`);
    try {
      if (!introSkipped && !introDone) {
        introBox.hidden = false;
        const d = reducedMotion() ? 2400 : Math.max(1500, 3000 / (+speedSel.value || 1));
        for (const li of introItems) {
          introItems.forEach((x) => x.classList.toggle("is-current", x === li));
          await wait(d, ctl.signal);
        }
        introItems.forEach((x) => x.classList.remove("is-current"));
        introDone = true;
      }
      for (let i = 0; i < seq.length; i++) {
        if (dead()) return;
        const r = await fetchRecon(seq[i], ctl.signal, id, run);
        if (dead()) return;
        if (!(await display(seq[i], r, dead))) return;
        if (i < seq.length - 1) await wait(dwell(), ctl.signal);
      }
      if (dead()) return;
      playing = false; setPlayUi();
      resume = { pos: displayedK, target };
      announce(endText());
      refreshComponent();
    } catch (err) {
      if (isAbort(err)) return;
      if (!dead()) { playing = false; setPlayUi(); showError(err); }
    }
  }
  function endText() {
    const r = state.recon, m = r.metrics, k = displayedK;
    return `Reached rank ${k} of ${maxRank}: ${pct(m.energy, 2)} of the energy retained, relative error ${pct(m.relative_error, 2)}, `
      + `${int(r.stored_values)} stored scalars versus ${int(r.original_values)} in the original (${num(r.ratio, 2)}× scalar-count ratio, not a file-size reduction).`;
  }
  btnPlay.addEventListener("click", () => (playing ? pause() : play()));
  btnRestart.addEventListener("click", () => {
    if (!spectrum) return;
    const target = playTarget || clampK(Number(rankInput.value) || 1);
    pause(false); play({ target });
  });
  introSkip.addEventListener("click", () => { introSkipped = true; introBox.hidden = true; });
  function renderIntro() {
    const s = spectrum.sigma[0];
    q("#intro-step-3").textContent = `Σ holds the singular values, largest first (here σ₁ = ${num(s[0], 1)}${s.length > 1 ? `, σ₂ = ${num(s[1], 1)}` : ""}${s.length > 2 ? `, σ₃ = ${num(s[2], 1)}` : ""}); the columns of U and V are the singular vectors.`;
    introBox.hidden = introSkipped;
  }

  speedSel.addEventListener("change", () => { /* dwell is read per step; nothing to restart */ });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  window.addEventListener("pagehide", () => pause(false));

  /* ---------- keyboard ---------- */
  stage.addEventListener("keydown", (e) => {
    if (!spectrum || tab !== "global" || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest("input, select, textarea, button, [role=slider], summary, a")) return;
    const big = e.shiftKey ? 10 : 1;
    const cur = displayedK ?? 1;
    const map = { ArrowRight: cur + big, ArrowUp: cur + big, ArrowLeft: cur - big, ArrowDown: cur - big, Home: 1, End: maxRank };
    if (e.key === " " || e.code === "Space") { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key in map) { e.preventDefault(); goTo(map[e.key]); }
  });

  /* ---------- compare toolbar ---------- */
  sideChk.addEventListener("change", () => compare.setSideBySide(sideChk.checked));
  diffChk.addEventListener("change", () => {
    if (!diffChk.checked) { compare.setDiff(null); return; }
    if (spectrum && displayedK) goTo(displayedK, { force: true, quiet: true });
  });
  btnFull.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else stage.requestFullscreen?.().catch(() => announce("Fullscreen was blocked by the browser."));
  });
  if (!document.fullscreenEnabled) { btnFull.disabled = true; btnFull.title = "Fullscreen is not available in this browser"; }
  document.addEventListener("fullscreenchange", () => { btnFull.textContent = document.fullscreenElement === stage ? "Exit fullscreen" : "Fullscreen"; });
  btnDownload.addEventListener("click", () => {
    if (!curImage) return;
    const a = document.createElement("a");
    a.href = curImage.src; a.download = curImage.name;
    document.body.append(a); a.click(); a.remove();
  });
  btnReset.addEventListener("click", resetAll);
  clearBtn.addEventListener("click", resetAll);

  function resetAll() {
    uploadSeq++; loadCtl && loadCtl.abort();
    cancelAll();
    imageId++; svdRun++; svdBusy = false;
    info = null; spectrum = null; displayedK = null; curImage = null; blocksRes = null; resume = null; playTarget = null;
    cache.clear();
    Object.assign(state, { info: null, spectrum: null, method: null, k: 1, recon: null });
    charts.setSpectrum(null); compare.clear();
    analysis.hidden = true; metaEl.hidden = true; notesEl.hidden = true; clearBtn.hidden = true;
    root.classList.remove("is-loaded");
    fileInput.value = ""; clearError(); setBusy(""); svdStatus.textContent = ""; announce("");
    gallery.setActive(null); setPlayUi(); syncEnabled();
    q("#lab-input").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
  }

  /* ---------- upload: click, keyboard, drag and drop ---------- */
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (f) loadFile(f);
  });
  for (const t of ["dragenter", "dragover"]) dropzone.addEventListener(t, (e) => { e.preventDefault(); dropzone.classList.add("is-drag"); });
  for (const t of ["dragleave", "dragend"]) dropzone.addEventListener(t, () => dropzone.classList.remove("is-drag"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault(); dropzone.classList.remove("is-drag");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  /* ---------- tabs ---------- */
  function setTab(name, focus = true) {
    tab = name;
    const g = name === "global";
    tabGlobal.setAttribute("aria-selected", String(g)); tabBlocks.setAttribute("aria-selected", String(!g));
    tabGlobal.tabIndex = g ? 0 : -1; tabBlocks.tabIndex = g ? -1 : 0;
    panelGlobal.hidden = !g; panelBlocks.hidden = g;
    below.hidden = !g; transport.hidden = !g; eqWrap.hidden = !g;
    if (!g) pause(false);
    if (info) {
      if (g) {
        if (spectrum && state.recon) { compare.setRecon(state.recon.image, `Rank ${displayedK} reconstruction`); compare.setTag(`Rank ${displayedK}`); stageTitle.textContent = `Rank ${displayedK} of ${maxRank} reconstruction`; curImage = { src: state.recon.image, name: `svdlab-rank-${displayedK}.png` }; }
        else { compare.setRecon(null); stageTitle.textContent = "Original image"; curImage = null; }
      } else if (blocksRes) {
        compare.setRecon(blocksRes.image, "Adaptive-block reconstruction"); compare.setTag("Adaptive blocks");
        stageTitle.textContent = `Adaptive blocks, mean rank ${num(blocksRes.metrics.mean_rank, 1)}`;
        curImage = { src: blocksRes.image, name: `svdlab-blocks-${blocksRes.block}.png` };
      } else { compare.setRecon(null); stageTitle.textContent = "Original image"; curImage = null; }
      compare.setDiff(null);
      syncEnabled();
      announce(g ? (spectrum && state.recon ? `Showing rank ${displayedK} of ${maxRank}.` : "Compute the SVD to see reconstructions.")
        : (blocksRes ? `Adaptive blocks: mean rank ${num(blocksRes.metrics.mean_rank, 1)}, ${pct(blocksRes.metrics.energy, 2)} of the energy retained.` : "Run adaptive blocks to see the result here."));
    }
    if (focus) (g ? tabGlobal : tabBlocks).focus();
  }
  tabGlobal.addEventListener("click", () => setTab("global", false));
  tabBlocks.addEventListener("click", () => setTab("blocks", false));
  for (const t of [tabGlobal, tabBlocks]) t.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      setTab(e.key === "ArrowLeft" || e.key === "Home" ? "global" : "blocks");
    }
  });

  /* ---------- adaptive blocks ---------- */
  blockEnergy.addEventListener("input", () => { blockEnergyOut.textContent = `${(100 * +blockEnergy.value).toFixed(1)} %`; });
  runBlocksBtn.addEventListener("click", async () => {
    if (!info || runBlocksBtn.disabled) return;
    const id = imageId, my = ++blocksRun;
    blocksCtl && blocksCtl.abort(); blocksCtl = new AbortController();
    runBlocksBtn.disabled = true; clearError();
    blocksStatus.textContent = "Computing an exact SVD for every tile…";
    const block = +blockSize.value, energy = +blockEnergy.value;
    try {
      const r = await api("/api/blocks", { method: "POST", body: form({ token: info.token, block, energy }), signal: blocksCtl.signal });
      if (id !== imageId || my !== blocksRun) return;
      blocksRes = { ...r, block };
      blocksStatus.textContent = "Done.";
      blocksResultEl.hidden = false;
      drawHeatmap(heat, r.ranks, { block, width: info.width, height: info.height });
      renderBlocksNumbers(r, block);
      if (tab === "blocks") setTab("blocks", false);
    } catch (err) {
      if (isAbort(err) || id !== imageId || my !== blocksRun) return;
      blocksStatus.textContent = "";
      showError(err);
    } finally {
      if (id === imageId && my === blocksRun) runBlocksBtn.disabled = !info.blocks_allowed;
    }
  });
  function renderBlocksNumbers(r, block) {
    const m = r.metrics || {};
    const rows = [
      ["Mean rank per tile", num(m.mean_rank, 2)], ["Tile size", `${block} × ${block} px (edge tiles may be smaller)`],
      ["Retained energy", pct(m.energy, 3)], ["Relative error", pct(m.relative_error, 3)],
      ["PSNR", m.psnr === null || m.psnr === undefined ? "∞ dB" : `${num(m.psnr, 2)} dB`], ["SSIM", num(m.ssim, 4)], ["MSE", num(m.mse, 3)],
      ["Stored scalars", `${int(r.stored_values)} of ${int(r.original_values)} (${num(r.ratio, 2)}× scalar-count ratio, not a file size)`],
      ["Reconstruction as PNG", bytes(r.png_bytes)],
    ];
    blocksDl.replaceChildren(...rows.map(([k, v]) => el("div", {}, el("dt", { text: k }), el("dd", { class: "mono", text: v }))));
  }

  /* ---------- tab-less wiring ---------- */
  on("ui:present", () => { /* layout is pure CSS under body.presenting */ });
  setPlayUi(); syncEnabled();
  initGallery(q("#gallery"), loadSample).then((g) => { gallery = g; if (info) gallery.setActive(info.source && info.source.sample); });
}
