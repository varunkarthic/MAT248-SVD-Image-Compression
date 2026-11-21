/* Small DOM helpers shared by the learning journey and the worked example. Pure presentation. */
import { el } from "../core.js";

/** Build a .matrix grid (base.css) from rows of numbers/strings. Returns {root, cells}. */
export function matrixEl(rows, { cls = "", tag = "span", label = "", tint = false, tabs = false } = {}) {
  const n = rows[0].length;
  const root = el("div", { class: `matrix lj-m ${cls}`.trim() });
  root.style.gridTemplateColumns = `repeat(${n}, auto)`;
  if (label) { root.setAttribute("role", "group"); root.setAttribute("aria-label", label); }
  const max = tint ? Math.max(1e-9, ...rows.flat().map((v) => Math.abs(Number(v)) || 0)) : 0;
  const cells = rows.map((r, i) => r.map((v, j) => {
    const c = el(tag, { text: String(v).replace("-", "\u2212"), "data-i": i, "data-j": j });
    if (tag === "button") c.type = "button";
    if (tabs) c.tabIndex = 0;
    if (tint) {
      const x = Number(v) / max;
      c.style.background = x >= 0 ? `rgba(31,78,163,${(0.08 + 0.42 * x).toFixed(3)})` : `rgba(200,62,38,${(0.08 + 0.42 * -x).toFixed(3)})`;
    }
    root.append(c);
    return c;
  }));
  return { root, cells };
}

export function setCls(cells, pred, cls) {
  cells.forEach((row, i) => row.forEach((c, j) => c.classList.toggle(cls, !!pred(i, j))));
}

export const sci = (x) => (Number.isInteger(x) ? String(x) : String(+x.toPrecision(6)));
export const minus = (s) => String(s).replace(/-/g, "\u2212");
export const scrollOpts = (reduced) => ({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
