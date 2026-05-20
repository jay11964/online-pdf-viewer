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
- Render pages
- Next / Prev page
- Zoom in / out
- Page number display
- Simple text search (jumps to the first matching page)

## Privacy

Your PDF stays on your machine. The app reads the file in your browser and does not upload it anywhere.
