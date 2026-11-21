/* Presentation mode + guided demonstration.
 * Presentation mode: `body.presenting` (enlarged type, secondary controls hidden), Fullscreen API when available,
 * Escape / "Exit" returns to the normal view. The guided tour is a 10-step floating panel that scrolls to the right
 * part of the page; it performs no computation itself. Keys: PageDown/PageUp (or the buttons) change step. */
import { $, el, emit, on } from "./core.js";

const STEPS = [
  { title: "What is an image matrix?", target: "#learn", say: "An image is a grid of numbers: rows and columns of pixel values." },
  { title: "Why do we need approximation?", target: "#learn", say: "Storing every entry is expensive. A low-rank approximation keeps only the strongest structure." },
  { title: "What is the SVD?", target: "#scenes", say: "Every matrix factors as U Σ Vᵀ. Σ holds the singular values, largest first." },
  { title: "The 2×2 matrix calculation", target: "#worked", say: "A = [[3,1],[1,3]]: eigenvalues 16 and 4 give singular values 4 and 2." },
  { title: "Apply SVD to an actual image", target: "#gallery, #lab", say: "Pick an image, choose exact or randomized SVD, press Compute SVD." },
  { title: "Watch rank-k reconstruction", target: "#compare, #lab", say: "Press Play: each frame is a real rank-k reconstruction, not a blur." },
  { title: "Singular values and retained energy", target: "#chart-sigma, #lab", say: "Singular values decay fast for structured images; energy E(k) climbs to 100 %." },
  { title: "Compare quality and storage", target: "#results, #lab", say: "PSNR and SSIM measure quality. The scalar count k(m+n+1) is not a file size." },
  { title: "Demonstrate adaptive blocks", target: "#tab-blocks, #lab", say: "Detailed tiles receive more rank. Open the Adaptive blocks tab." },
  { title: "Limitations and conclusions", target: "#finale", say: "SVD is optimal in Frobenius norm, but JPEG and WebP usually beat it on file size." },
];

let presenting = false;
let step = -1;
let panel;

function target(selectorList) {
  for (const sel of selectorList.split(",")) {
    const node = $(sel.trim());
    if (node && node.offsetParent !== null) return node;
  }
  return null;
}

function show(i) {
  step = Math.max(0, Math.min(STEPS.length - 1, i));
  const s = STEPS[step];
  $("[data-testid=tour-step]", panel).textContent = `Step ${step + 1} of ${STEPS.length}`;
  $("[data-testid=tour-title]", panel).textContent = s.title;
  $("[data-testid=tour-say]", panel).textContent = s.say;
  $("[data-testid=tour-prev]", panel).disabled = step === 0;
  $("[data-testid=tour-next]", panel).disabled = step === STEPS.length - 1;
  const node = target(s.target);
  if (node) node.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function buildPanel() {
  panel = el("aside", { class: "tour secondary-keep", "data-testid": "tour-panel", "aria-label": "Guided demonstration", hidden: true },
    el("p", { class: "tour__step mono", "data-testid": "tour-step" }),
    el("h2", { class: "tour__title", "data-testid": "tour-title" }),
    el("p", { class: "tour__say", "data-testid": "tour-say" }),
    el("div", { class: "tour__buttons" },
      el("button", { class: "btn", type: "button", "data-testid": "tour-prev", onclick: () => show(step - 1) }, "← Previous"),
      el("button", { class: "btn btn--primary", type: "button", "data-testid": "tour-next", onclick: () => show(step + 1) }, "Next →"),
      el("button", { class: "btn btn--quiet", type: "button", "data-testid": "present-exit", onclick: () => setPresenting(false) }, "Exit (Esc)")),
  );
  document.body.append(panel);
}

function setPresenting(on_) {
  if (on_ === presenting) return;
  presenting = on_;
  document.body.classList.toggle("presenting", on_);
  const btn = $("#btn-present");
  btn.setAttribute("aria-pressed", String(on_));
  btn.textContent = on_ ? "Exit presentation" : "Presentation mode";
  panel.hidden = !on_;
  if (on_) {
    show(Math.max(step, 0));
    document.documentElement.requestFullscreen?.().catch(() => { /* not allowed or unsupported: the CSS mode still works */ });
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  emit("ui:present", on_);
}

export function init() {
  buildPanel();
  $("#btn-present").addEventListener("click", () => setPresenting(!presenting));
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && presenting) setPresenting(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && presenting && !document.fullscreenElement) setPresenting(false);
    if (!presenting) return;
    if (e.key === "PageDown") { e.preventDefault(); show(step + 1); }
    if (e.key === "PageUp") { e.preventDefault(); show(step - 1); }
  });
  on("ui:section", () => {});
}
