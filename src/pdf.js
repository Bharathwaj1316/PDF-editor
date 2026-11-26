// Shared PDF helpers: loading, rendering, page-range parsing, zipping.
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export async function loadPdfLib(file) {
  const bytes = await readBytes(file);
  try {
    return await PDFDocument.load(bytes);
  } catch (e) {
    if (/encrypt/i.test(String(e))) {
      throw new Error(`"${file.name}" is password-protected. Unlock it first.`);
    }
    throw new Error(`Could not read "${file.name}": ${e.message}`);
  }
}

// pdf.js detaches the buffer it is given, so always pass a copy.
export async function loadPdfJs(file) {
  const bytes = await readBytes(file);
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

export async function renderPage(pdfjsDoc, pageNumber, scale) {
  const page = await pdfjsDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  return { canvas, viewport, page };
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Parse "1-3, 5, 8-" into groups of 0-based page indices.
 * Each comma-separated part is one group. Throws on invalid input.
 */
export function parseRanges(input, total) {
  const groups = [];
  for (const raw of input.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let start, end;
    if (m) {
      start = m[1] ? parseInt(m[1], 10) : 1;
      end = m[2] ? parseInt(m[2], 10) : total;
    } else if (/^\d+$/.test(part)) {
      start = end = parseInt(part, 10);
    } else {
      throw new Error(`Invalid page range "${part}"`);
    }
    if (start < 1 || end > total || start > end) {
      throw new Error(`Range "${part}" is outside 1-${total}`);
    }
    const g = [];
    for (let i = start; i <= end; i++) g.push(i - 1);
    groups.push(g);
  }
  if (!groups.length) throw new Error('Enter at least one page or range');
  return groups;
}

export function pdfBlob(bytes) {
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function zipOutputs(outputs) {
  const zip = new JSZip();
  for (const o of outputs) zip.file(o.name, o.blob);
  return zip.generateAsync({ type: 'blob' });
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, '');
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function hexToRgb01(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
