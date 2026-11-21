/* Entry point: loads each feature module in isolation (one failing module must not break the others),
 * then wires the global toolbar: detail switch, intro replay, presentation mode, section highlighting. */
import { $, $$, emit, on } from "./core.js";

const MODULES = ["intro", "learn", "scenes", "worked", "workspace", "finale", "present"];
const loaded = {};

for (const name of MODULES) {
  try {
    loaded[name] = await import(`./${name}.js`);
    loaded[name].init?.();
  } catch (err) {
    console.error(`SVD LAB: module "${name}" failed to load`, err);
  }
}

// ---- simple / details ----
const detailBtn = $("#btn-detail");
function setDetail(mode) {
  document.body.dataset.detail = mode;
  detailBtn.setAttribute("aria-pressed", String(mode === "details"));
  detailBtn.textContent = mode === "details" ? "Details: on" : "Details: off";
  try { localStorage.setItem("svdlab-detail", mode); } catch { /* private mode */ }
  emit("ui:detail", mode);
}
detailBtn.addEventListener("click", () => setDetail(document.body.dataset.detail === "details" ? "simple" : "details"));
let saved = null;
try { saved = localStorage.getItem("svdlab-detail"); } catch { /* ignore */ }
setDetail(saved === "details" ? "details" : "simple");

// ---- intro replay ----
$("#btn-replay").addEventListener("click", () => loaded.intro?.playIntro?.({ force: true }));

// ---- highlight the section in view ----
const links = $$(".site-nav a");
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === `#${entry.target.id}`)));
  }
}, { rootMargin: "-40% 0px -55% 0px" });
$$("main > section[id]").forEach((s) => observer.observe(s));

on("ui:section", (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
