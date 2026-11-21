/* Before/after comparison stage: overlay with a draggable divider, or side by side. */
import { $ } from "../core.js";

export function createCompare() {
  const root = $("#compare"), frame = $("#compare-frame"), view = $("#compare-view");
  const imgO = $("#compare-original"), imgR = $("#compare-recon"), handle = $("#compare-handle");
  const tagR = $("#tag-recon"), tagO = $("#tag-original");
  const diffFig = $("#diff-figure"), diffImg = $("#compare-diff"), diffCap = $("#diff-caption");
  let pos = 50, hasRecon = false, dragging = false;

  function setPos(p) {
    pos = Math.max(0, Math.min(100, p));
    root.style.setProperty("--pos", `${pos}%`);
    handle.setAttribute("aria-valuenow", String(Math.round(pos)));
    handle.setAttribute("aria-valuetext", `${Math.round(pos)} percent original on the left, ${100 - Math.round(pos)} percent reconstruction on the right`);
  }

  function pixelate() {
    const w = imgO.clientWidth, nw = imgO.naturalWidth;
    root.classList.toggle("is-pixelated", nw > 0 && w / nw > 2);
  }
  new ResizeObserver(pixelate).observe(frame);
  imgO.addEventListener("load", pixelate);

  function fromPointer(e) {
    const r = view.getBoundingClientRect();
    setPos(((e.clientX - r.left) / r.width) * 100);
  }
  view.addEventListener("pointerdown", (e) => {
    if (root.dataset.mode !== "overlay" || !hasRecon) return;
    if (e.pointerType !== "mouse" && e.target !== handle && !handle.contains(e.target)) return;
    dragging = true;
    view.setPointerCapture(e.pointerId);
    fromPointer(e);
    handle.focus({ preventScroll: true });
    e.preventDefault();
  });
  view.addEventListener("pointermove", (e) => { if (dragging) fromPointer(e); });
  const stop = (e) => { if (dragging) { dragging = false; try { view.releasePointerCapture(e.pointerId); } catch { /* already released */ } } };
  view.addEventListener("pointerup", stop);
  view.addEventListener("pointercancel", stop);

  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 2;
    const moves = { ArrowLeft: pos - step, ArrowDown: pos - step, ArrowRight: pos + step, ArrowUp: pos + step, Home: 0, End: 100 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    e.stopPropagation();
    setPos(moves[e.key]);
  });

  setPos(50);
  return {
    getPos: () => pos,
    setPos,
    setOriginal(src, w, h, alt) {
      root.style.setProperty("--ar", String(w / h));
      imgO.alt = alt || "Original image";
      imgO.src = src;
      if (!hasRecon) imgR.removeAttribute("src");
    },
    /** src may be null (nothing to compare yet). */
    setRecon(src, alt) {
      hasRecon = Boolean(src);
      root.classList.toggle("has-recon", hasRecon);
      tagR.hidden = !hasRecon;
      handle.hidden = !hasRecon;
      if (hasRecon) { imgR.src = src; imgR.alt = alt || "Reconstruction"; } else imgR.removeAttribute("src");
    },
    setTag(text) { tagR.textContent = text; },
    setSideBySide(on) { root.dataset.mode = on ? "side" : "overlay"; },
    setDiff(src, caption) {
      diffFig.hidden = !src;
      if (src) { diffImg.src = src; diffCap.textContent = caption; }
    },
    clear() {
      imgO.removeAttribute("src"); imgR.removeAttribute("src");
      hasRecon = false; root.classList.remove("has-recon"); tagR.hidden = true; handle.hidden = true; diffFig.hidden = true;
    },
    hasRecon: () => hasRecon,
    tagO,
  };
}
