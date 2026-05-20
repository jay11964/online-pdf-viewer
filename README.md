# Local PDF Viewer (localhost only)

Simple Acrobat-like PDF viewer for personal local use.

- React + TypeScript + Vite
- Tailwind CSS (dark UI)
- PDF rendering via `pdfjs-dist` (PDF.js)
- No backend, no cloud, no auth

## Run locally

From the `pdf-viewer` folder:

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

If you want to bind Vite to localhost explicitly:

```bash
npm run dev -- --host 127.0.0.1
```

## MVP features

- Open PDF from your computer (file picker)
- Render all pages (scroll)
- **Vertical** or **horizontal** layout toggle (zoom works in both)
- Next / Prev page (scrolls the focused page into view)
- Zoom in / out
- Page number display (click a page to focus it for “Clear page”)
- Simple text search (jumps to the first matching page)
- **Annotate**: pen + eraser on a canvas overlay; pen size; clear page / clear all (stored in React state / memory only)

## Privacy

Your PDF stays on your machine. The app reads the file in your browser and does not upload it anywhere.
