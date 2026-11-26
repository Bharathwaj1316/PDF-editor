// Tool definitions. Each tool declares its inputs and options, and a run()
// that returns { outputs: [{ name, blob }], note? }.
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  loadPdfLib, loadPdfJs, renderPage, canvasToBlob, parseRanges, pdfBlob,
  baseName, formatBytes, hexToRgb01, readBytes,
} from './pdf.js';
import { mountOrganize } from './organize.js';
import { mountSign } from './sign.js';

async function copyPages(src, indices) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out;
}

export const TOOLS = [
  {
    id: 'merge', title: 'Merge PDF', glyph: '⧉', color: '#e5484d',
    desc: 'Combine several PDFs into one, in the order you choose.',
    accept: 'pdf', multiple: true, minFiles: 2, reorder: true,
    options: [],
    async run(files) {
      const out = await PDFDocument.create();
      for (const f of files) {
        const src = await loadPdfLib(f);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      return { outputs: [{ name: 'merged.pdf', blob: pdfBlob(await out.save()) }] };
    },
  },
  {
    id: 'split', title: 'Split PDF', glyph: '✂', color: '#f76b15',
    desc: 'Split by custom ranges, every page, or fixed-size chunks.',
    accept: 'pdf', multiple: false,
    options: [
      { key: 'mode', label: 'Split mode', type: 'select', default: 'ranges', choices: [
        ['ranges', 'Custom ranges (one file per range)'],
        ['every', 'Every page into its own file'],
        ['chunk', 'Fixed number of pages per file'],
      ] },
      { key: 'ranges', label: 'Ranges', type: 'text', default: '1-2, 3-', showIf: { mode: 'ranges' },
        hint: 'e.g. 1-3, 4, 5-  (open end = last page)' },
      { key: 'chunk', label: 'Pages per file', type: 'number', default: 2, min: 1, showIf: { mode: 'chunk' } },
    ],
    async run([file], o) {
      const src = await loadPdfLib(file);
      const total = src.getPageCount();
      let groups;
      if (o.mode === 'every') groups = src.getPageIndices().map((i) => [i]);
      else if (o.mode === 'chunk') {
        const n = Math.max(1, o.chunk | 0);
        groups = [];
        for (let i = 0; i < total; i += n) groups.push(src.getPageIndices().slice(i, i + n));
      } else groups = parseRanges(o.ranges, total);
      const b = baseName(file.name);
      const outputs = [];
      for (const g of groups) {
        const doc = await copyPages(src, g);
        const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
        outputs.push({ name: `${b}_p${label}.pdf`, blob: pdfBlob(await doc.save()) });
      }
      return { outputs };
    },
  },
  {
    id: 'remove', title: 'Remove pages', glyph: '⌫', color: '#ce2c31',
    desc: 'Delete selected pages from a PDF.',
    accept: 'pdf', multiple: false,
    options: [{ key: 'pages', label: 'Pages to remove', type: 'text', default: '1', hint: 'e.g. 2, 5-7' }],
    async run([file], o) {
      const src = await loadPdfLib(file);
      const remove = new Set(parseRanges(o.pages, src.getPageCount()).flat());
      const keep = src.getPageIndices().filter((i) => !remove.has(i));
      if (!keep.length) throw new Error('That would remove every page.');
      const doc = await copyPages(src, keep);
      return { outputs: [{ name: `${baseName(file.name)}_removed.pdf`, blob: pdfBlob(await doc.save()) }],
        note: `Removed ${remove.size} page(s), ${keep.length} left.` };
    },
  },
  {
    id: 'extract', title: 'Extract pages', glyph: '⇱', color: '#d6409f',
    desc: 'Pull selected pages out into a new PDF.',
    accept: 'pdf', multiple: false,
    options: [{ key: 'pages', label: 'Pages to extract', type: 'text', default: '1-3', hint: 'e.g. 1, 3-4, 9' }],
    async run([file], o) {
      const src = await loadPdfLib(file);
      const idx = parseRanges(o.pages, src.getPageCount()).flat();
      const doc = await copyPages(src, idx);
      return { outputs: [{ name: `${baseName(file.name)}_extract.pdf`, blob: pdfBlob(await doc.save()) }] };
    },
  },
  {
    id: 'organize', title: 'Organize PDF', glyph: '▦', color: '#8e4ec6',
    desc: 'Drag pages to reorder, rotate or delete them visually.',
    accept: 'pdf', multiple: false, custom: mountOrganize,
  },
  {
    id: 'rotate', title: 'Rotate PDF', glyph: '↻', color: '#6e56cf',
    desc: 'Rotate all pages or just some of them.',
    accept: 'pdf', multiple: false,
    options: [
      { key: 'angle', label: 'Rotation', type: 'select', default: '90', choices: [
        ['90', '90° clockwise'], ['180', '180°'], ['270', '90° counter-clockwise'],
      ] },
      { key: 'pages', label: 'Pages', type: 'text', default: '', hint: 'Leave blank for all pages' },
    ],
    async run([file], o) {
      const doc = await loadPdfLib(file);
      const pages = doc.getPages();
      const idx = o.pages.trim() ? parseRanges(o.pages, pages.length).flat() : doc.getPageIndices();
      for (const i of idx) {
        const p = pages[i];
        p.setRotation(degrees((p.getRotation().angle + Number(o.angle)) % 360));
      }
      return { outputs: [{ name: `${baseName(file.name)}_rotated.pdf`, blob: pdfBlob(await doc.save()) }] };
    },
  },
  {
    id: 'compress', title: 'Compress PDF', glyph: '⇲', color: '#30a46c',
    desc: 'Shrink file size. Strong levels turn pages into images.',
    accept: 'pdf', multiple: false,
    options: [
      { key: 'level', label: 'Compression', type: 'select', default: 'medium', choices: [
        ['lossless', 'Lossless: restructure only, text stays selectable'],
        ['low', 'Light: 150 DPI images, high quality'],
        ['medium', 'Recommended: 110 DPI, good quality'],
        ['high', 'Extreme: 72 DPI, smallest file'],
      ] },
    ],
    async run([file], o) {
      let bytes;
      if (o.level === 'lossless') {
        const doc = await loadPdfLib(file);
        bytes = await doc.save({ useObjectStreams: true });
      } else {
        const { dpi, q } = { low: { dpi: 150, q: 0.8 }, medium: { dpi: 110, q: 0.65 }, high: { dpi: 72, q: 0.5 } }[o.level];
        const src = await loadPdfJs(file);
        const out = await PDFDocument.create();
        for (let n = 1; n <= src.numPages; n++) {
          const { canvas, page } = await renderPage(src, n, dpi / 72);
          const vp = page.getViewport({ scale: 1 });
          const jpg = await out.embedJpg(await (await canvasToBlob(canvas, 'image/jpeg', q)).arrayBuffer());
          const p = out.addPage([vp.width, vp.height]);
          p.drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
          canvas.width = canvas.height = 0;
        }
        bytes = await out.save({ useObjectStreams: true });
      }
      const before = file.size, after = bytes.length;
      const pct = Math.round((1 - after / before) * 100);
      const note = after < before
        ? `${formatBytes(before)} → ${formatBytes(after)} (${pct}% smaller)`
        : `Result is ${formatBytes(after)}, not smaller than the original ${formatBytes(before)}. This PDF is already well compressed; keep the original.`;
      return { outputs: [{ name: `${baseName(file.name)}_compressed.pdf`, blob: pdfBlob(bytes) }], note };
    },
  },
  {
    id: 'img2pdf', title: 'Images to PDF', glyph: '🖼', color: '#0090ff',
    desc: 'Turn JPG, PNG, WEBP and other images into a PDF.',
    accept: 'image', multiple: true, minFiles: 1, reorder: true,
    options: [
      { key: 'size', label: 'Page size', type: 'select', default: 'fit', choices: [
        ['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'US Letter'],
      ] },
      { key: 'orient', label: 'Orientation', type: 'select', default: 'auto', showIf: { size: ['a4', 'letter'] }, choices: [
        ['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape'],
      ] },
      { key: 'margin', label: 'Margin (pt)', type: 'number', default: 0, min: 0, showIf: { size: ['a4', 'letter'] } },
    ],
    async run(files, o) {
      const out = await PDFDocument.create();
      for (const f of files) {
        let img;
        if (f.type === 'image/jpeg') img = await out.embedJpg(await readBytes(f));
        else if (f.type === 'image/png') img = await out.embedPng(await readBytes(f));
        else {
          const bmp = await createImageBitmap(f);
          const c = document.createElement('canvas');
          c.width = bmp.width; c.height = bmp.height;
          c.getContext('2d').drawImage(bmp, 0, 0);
          img = await out.embedPng(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
        }
        if (o.size === 'fit') {
          out.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          continue;
        }
        let [w, h] = o.size === 'a4' ? [595.28, 841.89] : [612, 792];
        const landscape = o.orient === 'landscape' || (o.orient === 'auto' && img.width > img.height);
        if (landscape) [w, h] = [h, w];
        const m = Math.max(0, Number(o.margin) || 0);
        const s = Math.min((w - 2 * m) / img.width, (h - 2 * m) / img.height);
        const iw = img.width * s, ih = img.height * s;
        out.addPage([w, h]).drawImage(img, { x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih });
      }
      return { outputs: [{ name: 'images.pdf', blob: pdfBlob(await out.save()) }] };
    },
  },
  {
    id: 'pdf2img', title: 'PDF to images', glyph: '▣', color: '#12a594',
    desc: 'Export every page as a JPG or PNG image.',
    accept: 'pdf', multiple: false,
    options: [
      { key: 'format', label: 'Format', type: 'select', default: 'jpg', choices: [['jpg', 'JPG'], ['png', 'PNG']] },
      { key: 'dpi', label: 'Resolution', type: 'select', default: '150', choices: [
        ['72', '72 DPI (screen)'], ['150', '150 DPI (standard)'], ['300', '300 DPI (print)'],
      ] },
      { key: 'pages', label: 'Pages', type: 'text', default: '', hint: 'Leave blank for all pages' },
    ],
    async run([file], o, progress) {
      const src = await loadPdfJs(file);
      const idx = o.pages.trim() ? parseRanges(o.pages, src.numPages).flat() : [...Array(src.numPages).keys()];
      const type = o.format === 'png' ? 'image/png' : 'image/jpeg';
      const outputs = [];
      for (const [k, i] of idx.entries()) {
        progress(`Rendering page ${i + 1} (${k + 1}/${idx.length})…`);
        const { canvas } = await renderPage(src, i + 1, Number(o.dpi) / 72);
        outputs.push({ name: `${baseName(file.name)}_p${i + 1}.${o.format}`, blob: await canvasToBlob(canvas, type, 0.92) });
        canvas.width = canvas.height = 0;
      }
      return { outputs };
    },
  },
  {
    id: 'numbers', title: 'Page numbers', glyph: '#', color: '#3e63dd',
    desc: 'Stamp page numbers with your choice of position and style.',
    accept: 'pdf', multiple: false,
    options: [
      { key: 'pos', label: 'Position', type: 'select', default: 'bc', choices: [
        ['bc', 'Bottom center'], ['br', 'Bottom right'], ['bl', 'Bottom left'],
        ['tc', 'Top center'], ['tr', 'Top right'], ['tl', 'Top left'],
      ] },
      { key: 'format', label: 'Text', type: 'text', default: '{n}', hint: '{n} = page number, {total} = page count. e.g. "Page {n} of {total}"' },
      { key: 'start', label: 'First number', type: 'number', default: 1 },
      { key: 'from', label: 'Start on page', type: 'number', default: 1, min: 1 },
      { key: 'size', label: 'Font size', type: 'number', default: 11, min: 4 },
      { key: 'margin', label: 'Margin (pt)', type: 'number', default: 24, min: 0 },
      { key: 'color', label: 'Color', type: 'color', default: '#000000' },
    ],
    async run([file], o) {
      const doc = await loadPdfLib(file);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = doc.getPages();
      const [r, g, b] = hexToRgb01(o.color);
      const from = Math.max(1, o.from | 0);
      const total = pages.length - from + 1;
      pages.forEach((p, i) => {
        if (i + 1 < from) return;
        const text = o.format.replaceAll('{n}', String(Number(o.start) + i - (from - 1))).replaceAll('{total}', String(total));
        const { x: bx, y: by, width, height } = p.getCropBox();
        const tw = font.widthOfTextAtSize(text, o.size);
        const m = Number(o.margin);
        const x = o.pos[1] === 'c' ? bx + (width - tw) / 2 : o.pos[1] === 'l' ? bx + m : bx + width - m - tw;
        const y = o.pos[0] === 'b' ? by + m : by + height - m - o.size;
        p.drawText(text, { x, y, size: Number(o.size), font, color: rgb(r, g, b) });
      });
      return { outputs: [{ name: `${baseName(file.name)}_numbered.pdf`, blob: pdfBlob(await doc.save()) }] };
    },
  },
  {
    id: 'watermark', title: 'Watermark', glyph: '◈', color: '#a18072',
    desc: 'Stamp text across your pages, such as CONFIDENTIAL or DRAFT.',
    accept: 'pdf', multiple: false,
    options: [
      { key: 'text', label: 'Text', type: 'text', default: 'CONFIDENTIAL' },
      { key: 'size', label: 'Font size', type: 'number', default: 60, min: 6 },
      { key: 'angle', label: 'Angle (°)', type: 'number', default: 45 },
      { key: 'opacity', label: 'Opacity (%)', type: 'number', default: 25, min: 1, max: 100 },
      { key: 'color', label: 'Color', type: 'color', default: '#ff0000' },
      { key: 'pages', label: 'Pages', type: 'text', default: '', hint: 'Leave blank for all pages' },
    ],
    async run([file], o) {
      const doc = await loadPdfLib(file);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const pages = doc.getPages();
      const idx = o.pages.trim() ? parseRanges(o.pages, pages.length).flat() : doc.getPageIndices();
      const [r, g, b] = hexToRgb01(o.color);
      const size = Number(o.size), th = (Number(o.angle) * Math.PI) / 180;
      let w;
      try { w = font.widthOfTextAtSize(o.text, size); } catch {
        throw new Error('Watermark text can only use Latin characters (built-in PDF font).');
      }
      const h = size * 0.7;
      for (const i of idx) {
        const p = pages[i];
        const { x: bx, y: by, width, height } = p.getCropBox();
        const cx = bx + width / 2, cy = by + height / 2;
        p.drawText(o.text, {
          x: cx - (w / 2) * Math.cos(th) + (h / 2) * Math.sin(th),
          y: cy - (w / 2) * Math.sin(th) - (h / 2) * Math.cos(th),
          size, font, color: rgb(r, g, b), opacity: Number(o.opacity) / 100, rotate: degrees(Number(o.angle)),
        });
      }
      return { outputs: [{ name: `${baseName(file.name)}_watermarked.pdf`, blob: pdfBlob(await doc.save()) }] };
    },
  },
  {
    id: 'sign', title: 'Sign PDF', glyph: '✍', color: '#1c2024',
    desc: 'Draw or type your signature and place it on any page.',
    accept: 'pdf', multiple: false, custom: mountSign,
  },
  {
    id: 'meta', title: 'Edit metadata', glyph: 'ⓘ', color: '#687076',
    desc: 'Change the title, author, subject and keywords.',
    accept: 'pdf', multiple: false,
    options: [
      { key: 'title', label: 'Title', type: 'text', default: '', hint: 'Blank = keep current' },
      { key: 'author', label: 'Author', type: 'text', default: '' },
      { key: 'subject', label: 'Subject', type: 'text', default: '' },
      { key: 'keywords', label: 'Keywords', type: 'text', default: '', hint: 'Comma separated' },
    ],
    async run([file], o) {
      const doc = await loadPdfLib(file);
      const was = `Previous: title "${doc.getTitle() ?? ''}", author "${doc.getAuthor() ?? ''}"`;
      if (o.title) doc.setTitle(o.title);
      if (o.author) doc.setAuthor(o.author);
      if (o.subject) doc.setSubject(o.subject);
      if (o.keywords) doc.setKeywords(o.keywords.split(',').map((s) => s.trim()).filter(Boolean));
      return { outputs: [{ name: file.name, blob: pdfBlob(await doc.save()) }],
        note: was };
    },
  },
];
