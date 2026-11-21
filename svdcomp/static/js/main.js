/* Entry point: loads each feature module in isolation (one failing module must not break the others),
 * then wires the intro-replay button. */
import { $, on } from "./core.js";

const MODULES = ["intro", "workspace"];
const loaded = {};

// Fetch every module in parallel (faster start-up), then initialise in page order.
const imports = await Promise.allSettled(MODULES.map((name) => import(`./${name}.js`)));
imports.forEach((res, i) => {
  if (res.status === "rejected") { console.error(`SVD LAB: module "${MODULES[i]}" failed to load`, res.reason); return; }
  loaded[MODULES[i]] = res.value;
  try { res.value.init?.(); } catch (err) { console.error(`SVD LAB: module "${MODULES[i]}" failed to start`, err); }
});

// ---- intro replay ----
$("#btn-replay").addEventListener("click", () => loaded.intro?.playIntro?.({ force: true }));

on("ui:section", (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));

document.body.dataset.ready = "1";   // controls are wired; tests and slow machines can wait for this
