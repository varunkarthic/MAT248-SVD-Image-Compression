/* Shared plumbing for every SVD Lab module. No numerical code lives in the browser:
 * anything mathematical is fetched from the Flask API, which calls the svdcomp package.
 *
 * Event contract (all events are CustomEvents on `bus`; use `emit` / `on`):
 *   lab:image   detail = upload response {token,width,height,channels,original,source,...}
 *   lab:svd     detail = {spectrum, method}   (spectrum = /api/decompose response incl. curves)
 *   lab:rank    detail = {k, recon}           (recon = /api/reconstruct response now on screen)
 *   ui:detail   detail = "simple" | "details"
 *   ui:present  detail = true | false         (presentation mode)
 *   ui:section  detail = section id the guided tour / navigation wants to show
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => { bus.addEventListener(name, (e) => fn(e.detail)); };

/** Latest shared state. Modules read it; only the workspace writes it. */
export const state = { info: null, spectrum: null, method: null, k: 1, recon: null };

export const config = (() => {
  const d = (document.getElementById("app") || document.body).dataset;
  return {
    maxExactPixels: +d.maxExact || 262144,
    maxBlockPixels: +d.maxBlock || 1500000,
    defaultRank: +d.defaultRank || 150,
    maxUploadBytes: +d.maxUpload || 20 * 1024 * 1024,
    maxPixels: +d.maxPixels || 4000000,
  };
})();

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Could not reach the local server. Is svdcomp-web still running?");
  }
  const body = await res.json().catch(() => ({ error: `Server returned HTTP ${res.status}` }));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function form(obj) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(obj)) fd.append(key, value);
  return fd;
}

/** Number formatting: fixed decimals, "∞" for null (the API sends null for infinite PSNR). */
export const num = (x, d = 2) => (x === null || x === undefined ? "∞" : Number(x).toFixed(d));
export const pct = (x, d = 2) => (x === null || x === undefined ? "–" : `${(100 * x).toFixed(d)} %`);
export const int = (x) => Number(x).toLocaleString("en-US");
export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

/** Remove children and return the element; text is always set via textContent (no HTML injection). */
export function setText(el, text) { el.textContent = text; return el; }

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Create SVG-namespace elements. */
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
