// Interactive rank-k explorer. Precomputed by scripts/make_figures.py with svdcomp itself.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".svd-slider").forEach(async (box) => {
    const base = box.dataset.base;
    let steps;
    try {
      steps = await (await fetch(base + "slider.json")).json();
    } catch (err) {
      box.textContent = "Could not load the slider data.";
      return;
    }
    box.innerHTML = `
      <div class="panes">
        <figure><img alt="Rank-k reconstruction"><figcaption class="cap"></figcaption></figure>
        <figure><img src="${base}astronaut.png" alt="Original image"><figcaption>Original (256 × 256 × 3)</figcaption></figure>
      </div>
      <div class="control">
        <label class="k" for="svd-k"></label>
        <input id="svd-k" type="range" min="0" max="${steps.length - 1}" value="3" aria-label="Rank k">
      </div>
      <div class="chips">
        <div class="chip"><span>Compression ratio</span><b class="ratio"></b></div>
        <div class="chip"><span>PSNR</span><b class="psnr"></b></div>
        <div class="chip"><span>SSIM</span><b class="ssim"></b></div>
        <div class="chip"><span>Energy kept</span><b class="energy"></b></div>
      </div>`;
    steps.forEach((s) => { new Image().src = base + s.src; });  // preload
    const input = box.querySelector("input");
    const show = () => {
      const s = steps[+input.value];
      box.querySelector("img").src = base + s.src;
      box.querySelector(".k").textContent = `k = ${s.k}`;
      box.querySelector(".cap").textContent = `Rank ${s.k}: ${s.k} × (256 + 256 + 1) numbers per channel`;
      box.querySelector(".ratio").textContent = `${s.ratio.toFixed(2)}×`;
      box.querySelector(".psnr").textContent = `${s.psnr.toFixed(2)} dB`;
      box.querySelector(".ssim").textContent = s.ssim.toFixed(3);
      box.querySelector(".energy").textContent = `${s.energy.toFixed(2)} %`;
    };
    input.addEventListener("input", show);
    show();
  });
});
