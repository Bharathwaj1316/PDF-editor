import { TOOLS } from './tools.js';
import { zipOutputs, formatBytes } from './pdf.js';

const app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function route() {
  const id = location.hash.slice(1);
  const tool = TOOLS.find((t) => t.id === id);
  tool ? renderTool(tool) : renderHome();
}
window.addEventListener('hashchange', route);
document.getElementById('home-link').addEventListener('click', (e) => { e.preventDefault(); location.hash = ''; });

function renderHome() {
  app.innerHTML = `
    <section class="hero">
      <h1>Every PDF tool you need, offline</h1>
      <p>Merge, split, compress, convert, sign and more. Everything runs in your browser; nothing is uploaded.</p>
    </section>
    <section class="tool-grid">
      ${TOOLS.map((t) => `
        <a class="tool-card" href="#${t.id}">
          <span class="tool-icon" style="background:${t.color}">${t.glyph}</span>
          <h3>${t.title}</h3>
          <p>${t.desc}</p>
        </a>`).join('')}
    </section>`;
}

function optionInput(opt) {
  const id = `opt-${opt.key}`;
  let input;
  if (opt.type === 'select') {
    input = `<select id="${id}">${opt.choices.map(([v, l]) => `<option value="${v}" ${v === opt.default ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  } else {
    const attrs = [opt.min != null && `min="${opt.min}"`, opt.max != null && `max="${opt.max}"`].filter(Boolean).join(' ');
    input = `<input id="${id}" type="${opt.type}" value="${esc(opt.default)}" ${attrs}>`;
  }
  return `<div class="field" data-key="${opt.key}"><label for="${id}">${opt.label}</label>${input}${opt.hint ? `<small>${opt.hint}</small>` : ''}</div>`;
}

function renderTool(tool) {
  const accept = tool.accept === 'pdf' ? 'application/pdf,.pdf' : 'image/*';
  app.innerHTML = `
    <section class="tool-view">
      <a href="#" class="back">← All tools</a>
      <h1><span class="tool-icon sm" style="background:${tool.color}">${tool.glyph}</span> ${tool.title}</h1>
      <p class="sub">${tool.desc}</p>
      <label class="dropzone">
        <input type="file" accept="${accept}" ${tool.multiple ? 'multiple' : ''} hidden>
        <strong>Choose ${tool.accept === 'pdf' ? 'PDF' : 'image'} file${tool.multiple ? 's' : ''}</strong>
        <span>or drop ${tool.multiple ? 'them' : 'it'} here</span>
      </label>
      <ul class="file-list"></ul>
      <div class="workspace"></div>
      <div class="options"></div>
      <div class="actions"><button class="btn-primary run" disabled>${tool.title}</button></div>
      <div class="status"></div>
      <div class="results"></div>
    </section>`;

  const $ = (s) => app.querySelector(s);
  const input = $('.dropzone input');
  const dz = $('.dropzone');
  const list = $('.file-list');
  const runBtn = $('.run');
  const status = $('.status');
  const results = $('.results');
  const workspace = $('.workspace');
  let files = [];
  let custom = null;

  if (tool.options?.length) {
    $('.options').innerHTML = `<h3>Options</h3><div class="option-grid">${tool.options.map(optionInput).join('')}</div>`;
    const updateVisibility = () => {
      const vals = readOptions();
      for (const opt of tool.options) {
        if (!opt.showIf) continue;
        const ok = Object.entries(opt.showIf).every(([k, v]) => (Array.isArray(v) ? v.includes(vals[k]) : vals[k] === v));
        app.querySelector(`.field[data-key="${opt.key}"]`).hidden = !ok;
      }
    };
    $('.options').addEventListener('change', updateVisibility);
    updateVisibility();
  }

  function readOptions() {
    const o = {};
    for (const opt of tool.options || []) {
      const el = app.querySelector(`#opt-${opt.key}`);
      o[opt.key] = opt.type === 'number' ? Number(el.value) : el.value;
    }
    return o;
  }

  function isAccepted(f) {
    return tool.accept === 'pdf' ? f.type === 'application/pdf' || /\.pdf$/i.test(f.name) : f.type.startsWith('image/');
  }

  async function addFiles(newFiles) {
    const ok = [...newFiles].filter(isAccepted);
    if (ok.length < newFiles.length) setStatus('Some files were skipped because they are not the right type.', 'warn');
    if (!ok.length) return;
    files = tool.multiple ? files.concat(ok) : [ok[0]];
    results.innerHTML = '';
    drawList();
    if (tool.custom) {
      setStatus('Loading…');
      try {
        custom = await tool.custom(workspace, files[0]);
        setStatus('');
      } catch (e) { setStatus(e.message, 'error'); custom = null; }
    }
    updateRun();
  }

  function drawList() {
    list.innerHTML = files.map((f, i) => `
      <li>
        <span class="fname">${esc(f.name)}</span>
        <span class="fsize">${formatBytes(f.size)}</span>
        ${tool.reorder ? `<button data-a="up" data-i="${i}" title="Move up">↑</button><button data-a="down" data-i="${i}" title="Move down">↓</button>` : ''}
        <button data-a="rm" data-i="${i}" title="Remove">✕</button>
      </li>`).join('');
    dz.classList.toggle('compact', files.length > 0);
  }
  list.addEventListener('click', (e) => {
    const { a, i } = e.target.dataset;
    if (!a) return;
    const k = Number(i);
    if (a === 'rm') { files.splice(k, 1); if (tool.custom) { workspace.innerHTML = ''; custom = null; } }
    if (a === 'up' && k > 0) [files[k - 1], files[k]] = [files[k], files[k - 1]];
    if (a === 'down' && k < files.length - 1) [files[k + 1], files[k]] = [files[k], files[k + 1]];
    drawList(); updateRun();
  });

  function updateRun() {
    runBtn.disabled = files.length < (tool.minFiles || 1) || (tool.custom && !custom);
    if (tool.minFiles > 1 && files.length === 1) setStatus(`Add at least ${tool.minFiles} files.`);
  }

  function setStatus(msg, kind = '') {
    status.className = `status ${kind}`;
    status.textContent = msg;
  }

  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('hover'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('hover'); }));
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;
    results.innerHTML = '';
    setStatus('Working…');
    try {
      const res = custom ? await custom.run() : await tool.run(files, readOptions(), (m) => setStatus(m));
      await showResults(res);
      setStatus(res.note || 'Done.', 'ok');
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), 'error');
    } finally {
      runBtn.disabled = false;
    }
  });

  async function showResults({ outputs }) {
    const urls = [];
    const link = (blob, name, cls = '') => {
      const url = URL.createObjectURL(blob); urls.push(url);
      return `<a class="${cls}" href="${url}" download="${esc(name)}">${esc(name)} <small>${formatBytes(blob.size)}</small></a>`;
    };
    let html = '';
    if (outputs.length > 1) {
      const zip = await zipOutputs(outputs);
      html += `<div class="dl-main">${link(zip, 'results.zip', 'btn-primary')}</div>`;
      html += `<details><summary>${outputs.length} files, download individually</summary><div class="dl-list">${outputs.map((o) => link(o.blob, o.name)).join('')}</div></details>`;
    } else {
      html += `<div class="dl-main">${link(outputs[0].blob, outputs[0].name, 'btn-primary')}</div>`;
    }
    results.innerHTML = html;
  }
}

route();
