/* Tiny time-based animation player shared by the intro, the teaching scenes and the finale.
 * It only runs requestAnimationFrame while actually playing, finishes (never loops) and pauses
 * itself when the page is hidden or being unloaded. */

const live = new Set();
const pauseAll = () => live.forEach((p) => p.pause());
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseAll(); });
window.addEventListener("pagehide", pauseAll);

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Smoothstep of the sub-interval [a, b] of t. */
export const seg = (t, a, b) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };

/**
 * createPlayer({duration, onFrame(t), onState(state)})
 *   state is "idle" | "playing" | "paused" | "ended". t is seconds in [0, duration].
 */
export function createPlayer({ duration, onFrame, onState = () => {} }) {
  let raf = 0, t = 0, origin = 0, state = "idle";
  const set = (s) => { state = s; onState(s); };
  const tick = (now) => {
    t = clamp((now - origin) / 1000, 0, duration);
    onFrame(t);
    if (t >= duration) { raf = 0; live.delete(player); set("ended"); return; }
    raf = requestAnimationFrame(tick);
  };
  const player = {
    get time() { return t; },
    get state() { return state; },
    play() {
      if (state === "playing") return;
      if (t >= duration) t = 0;
      origin = performance.now() - t * 1000;
      live.add(player);
      set("playing");
      raf = requestAnimationFrame(tick);
    },
    pause() {
      if (state !== "playing") return;
      cancelAnimationFrame(raf); raf = 0; live.delete(player); set("paused");
    },
    /** Jump to time x (seconds) and draw it; keeps playing if it was playing. */
    seek(x) {
      t = clamp(x, 0, duration);
      origin = performance.now() - t * 1000;
      onFrame(t);
    },
    /** Stop, cancel the frame request and optionally jump to the end state. */
    stop(toEnd = false) {
      cancelAnimationFrame(raf); raf = 0; live.delete(player);
      if (toEnd) { t = duration; onFrame(t); set("ended"); } else set(t > 0 ? "paused" : "idle");
    },
    duration,
  };
  return player;
}

/** Diverging colour used everywhere for signed values: cobalt (negative), paper (0), vermilion (positive).
 *  The same three anchors as the server-side component images (svdcomp/lab.py). */
export const NEG = [31, 78, 163], MID = [250, 247, 240], POS = [200, 62, 38];
export function diverging(v, vmax) {
  const t = vmax > 0 ? clamp(v / vmax, -1, 1) : 0, a = Math.abs(t), c = t < 0 ? NEG : POS;
  return `rgb(${[0, 1, 2].map((i) => Math.round(MID[i] + (c[i] - MID[i]) * a)).join(",")})`;
}
/** Readable text colour (ink or white) for a diverging background. */
export const textOn = (v, vmax) => (Math.abs(v) / (vmax || 1) > 0.55 ? "#fff" : "#1c1e23");
