// Signature tool: draw or type a signature, click on pages to place it.
import { loadPdfLib, loadPdfJs, renderPage, pdfBlob, baseName } from './pdf.js';

function trimCanvas(c) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export async function mountSign(container, file) {
  container.innerHTML = `
    <div class="sign-layout">
      <div class="sign-side">
        <div class="seg">
          <button data-mode="draw" class="active">Draw</button>
          <button data-mode="type">Type</button>
        </div>
        <canvas class="sig-pad" width="500" height="180"></canvas>
        <div class="type-box" hidden>
          <input type="text" class="sig-text" placeholder="Your name">
        </div>
        <div class="row">
          <label>Ink <input type="color" class="sig-color" value="#1a237e"></label>
          <button class="btn-ghost sig-clear">Clear</button>
        </div>
        <label>Signature width (% of page)
          <input type="range" class="sig-size" min="8" max="60" value="25">
        </label>
        <p class="hint">Click on the page to place the signature. Click a placed signature to remove it.</p>
        <div class="row">
          <button class="btn-ghost prev">◀</button>
          <span class="page-label"></span>
          <button class="btn-ghost next">▶</button>
        </div>
      </div>
      <div class="sign-stage"><div class="stage-inner"><canvas class="page-canvas"></canvas></div></div>
    </div>`;

  const pad = container.querySelector('.sig-pad');
  const pctx = pad.getContext('2d');
  const colorIn = container.querySelector('.sig-color');
  const textIn = container.querySelector('.sig-text');
  const sizeIn = container.querySelector('.sig-size');
  const stage = container.querySelector('.stage-inner');
  const pageCanvas = container.querySelector('.page-canvas');
  const label = container.querySelector('.page-label');
  let mode = 'draw';
  let sigUrl = null;

  // Drawing on the pad.
  let drawing = false;
  const pos = (e) => {
    const r = pad.getBoundingClientRect();
    return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)];
  };
  pad.addEventListener('pointerdown', (e) => {
    if (mode !== 'draw') return;
    drawing = true; pad.setPointerCapture(e.pointerId);
    pctx.beginPath(); pctx.moveTo(...pos(e));
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    pctx.lineWidth = 3; pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    pctx.strokeStyle = colorIn.value;
    pctx.lineTo(...pos(e)); pctx.stroke();
  });
  pad.addEventListener('pointerup', () => { drawing = false; refreshSig(); });

  function renderTyped() {
    pctx.clearRect(0, 0, pad.width, pad.height);
    pctx.fillStyle = colorIn.value;
    pctx.font = 'italic 64px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive';
    pctx.textBaseline = 'middle';
    pctx.fillText(textIn.value, 20, pad.height / 2);
    refreshSig();
  }
  textIn.addEventListener('input', renderTyped);
  colorIn.addEventListener('input', () => { if (mode === 'type') renderTyped(); });

  container.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    container.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('active', x === b));
    mode = b.dataset.mode;
    container.querySelector('.type-box').hidden = mode !== 'type';
    pctx.clearRect(0, 0, pad.width, pad.height);
    if (mode === 'type') renderTyped(); else refreshSig();
  }));
  container.querySelector('.sig-clear').addEventListener('click', () => {
    pctx.clearRect(0, 0, pad.width, pad.height); textIn.value = ''; refreshSig();
  });

  function refreshSig() {
    const t = trimCanvas(pad);
    sigUrl = t ? t.toDataURL('image/png') : null;
    sigAspect = t ? t.height / t.width : 0.3;
  }
  let sigAspect = 0.3;

  // Page preview & placements. Placement coords are fractions of the viewport.
  const src = await loadPdfJs(file);
  let current = 1;
  let viewport = null;
  const placements = []; // { page, nx, ny, nw, url, aspect }

  async function showPage() {
    label.textContent = `Page ${current} / ${src.numPages}`;
    const maxW = Math.min(stage.parentElement.clientWidth - 20, 800);
    const page = await src.getPage(current);
    const scale = maxW / page.getViewport({ scale: 1 }).width;
    const r = await renderPage(src, current, scale);
    viewport = r.viewport;
    pageCanvas.width = r.canvas.width; pageCanvas.height = r.canvas.height;
    pageCanvas.getContext('2d').drawImage(r.canvas, 0, 0);
    drawPlacements();
  }
  function drawPlacements() {
    stage.querySelectorAll('.placed').forEach((n) => n.remove());
    placements.forEach((p, i) => {
      if (p.page !== current) return;
      const img = document.createElement('img');
      img.className = 'placed';
      img.src = p.url;
      img.style.left = `${p.nx * 100}%`;
      img.style.top = `${p.ny * 100}%`;
      img.style.width = `${p.nw * 100}%`;
      img.addEventListener('click', (e) => { e.stopPropagation(); placements.splice(i, 1); drawPlacements(); });
      stage.appendChild(img);
    });
  }
  pageCanvas.addEventListener('click', (e) => {
    if (!sigUrl) { alert('Draw or type a signature first.'); return; }
    const r = pageCanvas.getBoundingClientRect();
    const nw = sizeIn.value / 100;
    const nh = (nw * r.width * sigAspect) / r.height;
    const cx = (e.clientX - r.left) / r.width, cy = (e.clientY - r.top) / r.height;
    placements.push({ page: current, nx: cx - nw / 2, ny: cy - nh / 2, nw, nh, url: sigUrl });
    drawPlacements();
  });
  container.querySelector('.prev').addEventListener('click', () => { if (current > 1) { current--; showPage(); } });
  container.querySelector('.next').addEventListener('click', () => { if (current < src.numPages) { current++; showPage(); } });
  await showPage();

  return {
    async run() {
      if (!placements.length) throw new Error('Place your signature on at least one page.');
      const doc = await loadPdfLib(file);
      const pages = doc.getPages();
      const cache = new Map();
      for (const p of placements) {
        if (!cache.has(p.url)) cache.set(p.url, await doc.embedPng(p.url));
        const img = cache.get(p.url);
        const pdfPage = await src.getPage(p.page);
        const vp = pdfPage.getViewport({ scale: 1 });
        // Convert the placement's corners from viewport space to PDF user space.
        const [ax, ay] = vp.convertToPdfPoint(p.nx * vp.width, p.ny * vp.height);
        const [bx, by] = vp.convertToPdfPoint((p.nx + p.nw) * vp.width, (p.ny + p.nh) * vp.height);
        pages[p.page - 1].drawImage(img, {
          x: Math.min(ax, bx), y: Math.min(ay, by),
          width: Math.abs(bx - ax), height: Math.abs(by - ay),
        });
      }
      return { outputs: [{ name: `${baseName(file.name)}_signed.pdf`, blob: pdfBlob(await doc.save()) }] };
    },
  };
}
