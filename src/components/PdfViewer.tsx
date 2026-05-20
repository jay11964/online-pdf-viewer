import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

type LoadState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'ready'; name: string }
  | { kind: 'error'; message: string }

export function PdfViewer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'empty' })
  const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.1)

  const [query, setQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState<string>('')
  const [pageTextCache, setPageTextCache] = useState<Record<number, string>>({})

  const canGoPrev = pageNumber > 1
  const canGoNext = numPages > 0 && pageNumber < numPages

  const zoomLabel = useMemo(() => `${Math.round(scale * 100)}%`, [scale])

  async function onPickFile(file: File) {
    setLoadState({ kind: 'loading' })
    setSearchStatus('')
    setPageTextCache({})
    setPdfDoc(null)
    setPageNumber(1)
    setNumPages(0)

    try {
      const buf = await file.arrayBuffer()
      const loadingTask = pdfjs.getDocument({ data: buf })
      const doc = await loadingTask.promise

      setPdfDoc(doc)
      setNumPages(doc.numPages)
      setLoadState({ kind: 'ready', name: file.name })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load PDF.'
      setLoadState({ kind: 'error', message })
    }
  }

  useEffect(() => {
    let cancelled = false
    let renderTask: pdfjs.RenderTask | null = null

    async function render() {
      if (!pdfDoc) return
      const canvas = canvasRef.current
      if (!canvas) return

      const page = await pdfDoc.getPage(pageNumber)
      if (cancelled) return

      const viewport = page.getViewport({ scale })
      const context = canvas.getContext('2d')
      if (!context) return

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)

      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise
    }

    render().catch(() => {
      // ignore render errors (e.g., cancelled renders)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdfDoc, pageNumber, scale])

  async function getPageText(page: number) {
    const cached = pageTextCache[page]
    if (cached !== undefined) return cached
    if (!pdfDoc) return ''

    const p = await pdfDoc.getPage(page)
    const content = await p.getTextContent()
    const text = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    setPageTextCache((prev) => ({ ...prev, [page]: text }))
    return text
  }

  async function runSearch() {
    setSearchStatus('')

    const q = query.trim()
    if (!q) return
    if (!pdfDoc) return

    setSearchStatus('Searching…')
    const needle = q.toLowerCase()

    try {
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        const text = (await getPageText(p)).toLowerCase()
        if (text.includes(needle)) {
          setPageNumber(p)
          setSearchStatus(`Found on page ${p}`)
          return
        }
      }
      setSearchStatus('No matches found')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Search failed.'
      setSearchStatus(message)
    }
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-3 py-2">
          <label className="inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-800">
            <input
              className="hidden"
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onPickFile(f)
                e.currentTarget.value = ''
              }}
            />
            <span className="font-medium">Open PDF</span>
            {loadState.kind === 'ready' ? (
              <span className="max-w-[16rem] truncate text-zinc-400">
                {loadState.name}
              </span>
            ) : null}
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!pdfDoc || !canGoPrev}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!pdfDoc || !canGoNext}
              onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>

          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="tabular-nums">
              Page <span className="text-zinc-100">{numPages ? pageNumber : 0}</span> /{' '}
              <span className="text-zinc-100">{numPages}</span>
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={!pdfDoc}
              onClick={() => setScale((s) => Math.max(0.5, Math.round((s - 0.1) * 10) / 10))}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              –
            </button>
            <div className="min-w-[4.5rem] select-none text-center text-sm text-zinc-200 tabular-nums">
              {zoomLabel}
            </div>
            <button
              type="button"
              disabled={!pdfDoc}
              onClick={() => setScale((s) => Math.min(3, Math.round((s + 0.1) * 10) / 10))}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              +
            </button>
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch()
              }}
              disabled={!pdfDoc}
              placeholder="Search text…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:opacity-40 sm:w-56"
            />
            <button
              type="button"
              disabled={!pdfDoc || !query.trim()}
              onClick={() => void runSearch()}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Find
            </button>
            {searchStatus ? (
              <span className="text-xs text-zinc-400">{searchStatus}</span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-3 py-6">
        {loadState.kind === 'empty' ? (
          <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-left">
            <div className="text-lg font-semibold text-zinc-100">Local PDF Viewer</div>
            <div className="mt-1 text-sm text-zinc-400">
              Click <span className="text-zinc-200">Open PDF</span> to load a file from your
              computer. Nothing is uploaded anywhere.
            </div>
          </div>
        ) : null}

        {loadState.kind === 'loading' ? (
          <div className="text-sm text-zinc-400">Loading…</div>
        ) : null}

        {loadState.kind === 'error' ? (
          <div className="w-full rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
            {loadState.message}
          </div>
        ) : null}

        <div className="w-full overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="mx-auto w-fit">
            <canvas ref={canvasRef} className="block rounded bg-white shadow" />
          </div>
        </div>
      </main>
    </div>
  )
}

