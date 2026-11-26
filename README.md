# PDF Workbench

A set of PDF tools that runs entirely in the browser. Files are never uploaded.

Tools: merge, split, remove pages, extract pages, organize (drag to reorder, rotate, delete), rotate, compress, images to PDF, PDF to images, page numbers, watermark, sign, edit metadata.

Built with [pdf-lib](https://pdf-lib.js.org/), [pdf.js](https://mozilla.github.io/pdf.js/) and [JSZip](https://stuk.github.io/jszip/).

## Run locally

```bash
npm install
npm run dev
```

Or double-click `start.bat` on Windows.

## Deploy

Pushing to `main` builds the site and publishes it to GitHub Pages via `.github/workflows/deploy.yml`.
