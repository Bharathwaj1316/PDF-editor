// Visual page organizer: drag to reorder, rotate, delete.
import { PDFDocument, degrees } from 'pdf-lib';
import { loadPdfLib, loadPdfJs, renderPage, pdfBlob, baseName } from './pdf.js';

export async function mountOrganize(container, file) {
  container.innerHTML = `
    <p class="hint">Drag pages to reorder. Use the buttons on each page to rotate or delete it.</p>
    <div class="page-grid"></div>`;
  const grid = container.querySelector('.page-grid');
  const src = await loadPdfJs(file);

  // Each item: original 0-based index and extra rotation.
  let items = [];
  for (let n = 1; n <= src.numPages; n++) {
    const { canvas } = await renderPage(src, n, 0.35);
    items.push({ index: n - 1, rot: 0, thumb: canvas.toDataURL('image/jpeg', 0.7) });
  }

  let dragFrom = null;
  function draw() {
    grid.innerHTML = '';
    items.forEach((it, pos) => {
      const card = document.createElement('div');
      card.className = 'page-card';
      card.draggable = true;
      card.innerHTML = `
        <div class="thumb-wrap"><img src="${it.thumb}" style="transform: rotate(${it.rot}deg)"></div>
        <div class="page-actions">
          <button data-a="left" title="Rotate left">↺</button>
          <span>${it.index + 1}</span>
          <button data-a="right" title="Rotate right">↻</button>
          <button data-a="del" title="Delete" class="danger">✕</button>
        </div>`;
      card.addEventListener('click', (e) => {
        const a = e.target.dataset?.a;
        if (a === 'left') it.rot = (it.rot + 270) % 360;
        else if (a === 'right') it.rot = (it.rot + 90) % 360;
        else if (a === 'del') items.splice(pos, 1);
        else return;
        draw();
      });
      card.addEventListener('dragstart', () => { dragFrom = pos; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('over'); });
      card.addEventListener('dragleave', () => card.classList.remove('over'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragFrom === null || dragFrom === pos) return;
        const [moved] = items.splice(dragFrom, 1);
        items.splice(pos, 0, moved);
        dragFrom = null;
        draw();
      });
      grid.appendChild(card);
    });
  }
  draw();

  return {
    async run() {
      if (!items.length) throw new Error('All pages were deleted.');
      const doc = await loadPdfLib(file);
      const out = await PDFDocument.create();
      const pages = await out.copyPages(doc, items.map((i) => i.index));
      pages.forEach((p, k) => {
        p.setRotation(degrees((p.getRotation().angle + items[k].rot) % 360));
        out.addPage(p);
      });
      return { outputs: [{ name: `${baseName(file.name)}_organized.pdf`, blob: pdfBlob(await out.save()) }] };
    },
  };
}
