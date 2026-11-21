/* Adaptive-blocks rank heatmap: one crisp cell per tile, colour = rank, tile coordinates on hover/focus. */
import { $ } from "../core.js";

const LOW = [236, 230, 214], HIGH = [22, 58, 124];   // paper -> deep cobalt
const ramp = (t) => `rgb(${LOW.map((l, i) => Math.round(l + (HIGH[i] - l) * t)).join(",")})`;

export function drawHeatmap(canvas, ranks, { block, width, height }) {
  const rows = ranks.length, cols = ranks[0].length;
  const flat = ranks.flat();
  const max = Math.max(...flat), min = Math.min(...flat);
  const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
  const cell = Math.max(2, Math.min(40, Math.floor(560 / cols)));
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d");
  const paint = (focus) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      ctx.fillStyle = ramp(max > 0 ? ranks[r][c] / max : 0);
      ctx.fillRect(c * cell, r * cell, cell, cell);
      if (cell >= 8) { ctx.strokeStyle = "rgba(28,30,35,.18)"; ctx.lineWidth = 1; ctx.strokeRect(c * cell + .5, r * cell + .5, cell - 1, cell - 1); }
    }
    if (focus) {
      ctx.lineWidth = Math.max(2, cell / 6);
      ctx.strokeStyle = "#c83e26";
      ctx.strokeRect(focus.c * cell + ctx.lineWidth / 2, focus.r * cell + ctx.lineWidth / 2, cell - ctx.lineWidth, cell - ctx.lineWidth);
    }
  };
  paint(null);
  $("#heat-min").textContent = "0";
  $("#heat-max").textContent = String(max);
  const caption = $("#heat-caption");
  const describe = (r, c) => {
    const x0 = c * block, y0 = r * block;
    const x1 = Math.min(width, x0 + block) - 1, y1 = Math.min(height, y0 + block) - 1;
    return `tile row ${r + 1}, column ${c + 1} (pixels x ${x0}–${x1}, y ${y0}–${y1}): rank ${ranks[r][c]}`;
  };
  let cur = { r: 0, c: 0 };
  const show = (r, c) => { cur = { r, c }; paint(cur); caption.textContent = describe(r, c); };
  canvas.onpointermove = (e) => {
    const b = canvas.getBoundingClientRect();
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((e.clientX - b.left) / b.width) * cols)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor(((e.clientY - b.top) / b.height) * rows)));
    show(r, c);
  };
  canvas.onpointerleave = () => { paint(null); caption.textContent = "Hover or focus the map to read a tile."; };
  canvas.onfocus = () => show(cur.r, cur.c);
  canvas.onblur = () => paint(null);
  canvas.onkeydown = (e) => {
    const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!d) return;
    e.preventDefault();
    show(Math.min(rows - 1, Math.max(0, cur.r + d[0])), Math.min(cols - 1, Math.max(0, cur.c + d[1])));
  };
  const summary = `Rank heatmap with ${rows} by ${cols} tiles of ${block} pixels. Ranks range from ${min} to ${max}, mean ${mean.toFixed(2)}. Use the arrow keys to read individual tiles.`;
  canvas.setAttribute("aria-label", summary);
  $("#heat-summary").textContent = summary;
  caption.textContent = "Hover or focus the map to read a tile.";
  return { min, max, mean, rows, cols };
}
