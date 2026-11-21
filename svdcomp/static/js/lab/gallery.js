/* Sample gallery: a contact sheet of the bundled images. Only local URLs are used. */
import { api, el, $$ } from "../core.js";

export async function initGallery(host, onPick) {
  let samples;
  try {
    samples = (await api("/api/samples")).samples;
  } catch (err) {
    host.replaceChildren(el("p", { class: "muted", role: "alert", text: `Could not load the sample list: ${err.message}` }));
    return { setActive() {}, setBusy() {} };
  }
  const frames = samples.map((s, i) => {
    const btn = el("button", { type: "button", class: "gal-frame", "data-sample-id": s.id, "data-testid": `sample-${s.id}`, "aria-pressed": "false" },
      el("span", { class: "gal-no mono", "aria-hidden": "true", text: String(i + 1).padStart(2, "0") }),
      el("span", { class: "gal-thumb" }, el("img", { src: s.url, alt: s.title, class: s.width <= 64 ? "pix" : "", loading: "lazy", draggable: "false" })),
      el("span", { class: "gal-title", text: s.title }),
      el("span", { class: "gal-size mono", text: `${s.width}×${s.height} · ${s.channels === 1 ? "gray" : "RGB"}` }),
      el("span", { class: "gal-desc secondary", text: s.description }),
      el("span", { class: "gal-why secondary" }, el("em", { text: "Why: " }), s.why));
    btn.addEventListener("click", () => onPick(s));
    return btn;
  });
  host.replaceChildren(...frames);
  return {
    setActive(id) { $$(".gal-frame", host).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sampleId === id))); },
  };
}
