import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

type LoadState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'ready'; name: string }
  | { kind: 'error'; message: string }

export type ScrollDirection = 'vertical' | 'horizontal'

type DrawTool = 'pen' | 'eraser'

/** Strokes stored in pixel space of baseWidth×baseHeight so they rescale when zoom changes */
export type Stroke = {
  tool: DrawTool
  lineWidth: number
  points: { x: number; y: number }[]
  baseWidth: number
  baseHeight: number
}

type DrawingsByPage = Record<number, Stroke[]>

function strokeSingle(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  s: Stroke,
) {
  if (s.points.length === 0) return
  const sx = cw / s.baseWidth
  const sy = ch / s.baseHeight
  const scale = (sx + sy) / 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, s.lineWidth * scale)
  ctx.strokeStyle = s.tool === 'eraser' ? 'rgba(0,0,0,1)' : 'rgba(250, 204, 21, 0.95)'
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.beginPath()
  ctx.moveTo(s.points[0].x * sx, s.points[0].y * sy)
  for (let i = 1; i < s.points.length; i++) {
    ctx.lineTo(s.points[i].x * sx, s.points[i].y * sy)
  }
  ctx.stroke()
}

function redrawOverlay(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  strokes: Stroke[],
) {
  ctx.clearRect(0, 0, cw, ch)
  for (const s of strokes) strokeSingle(ctx, cw, ch, s)
  ctx.globalCompositeOperation = 'source-over'
}

type PdfPageBlockProps = {
  pageNum: number
  pdfDoc: pdfjs.PDFDocumentProxy
  scale: number
  strokes: Stroke[]
  onStrokesChange: (pageNum: number, updater: Stroke[] | ((prev: Stroke[]) => Stroke[])) => void
  annotateMode: boolean
  drawTool: DrawTool
  penSize: number
  /** When this increments, scroll focused page into view */
  scrollTick: number
  focusedPage: number
  onFocusPage: (pageNum: number) => void
}

function PdfPageBlock({
  pageNum,
  pdfDoc,
  scale,
  strokes,
  onStrokesChange,
  annotateMode,
  drawTool,
  penSize,
  scrollTick,
  focusedPage,
  onFocusPage,
}: PdfPageBlockProps) {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const currentStrokeRef = useRef<Stroke | null>(null)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes

  useEffect(() => {
    if (!scrollTick || pageNum !== focusedPage) return
    wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [scrollTick, focusedPage, pageNum])

  useEffect(() => {
    let cancelled = false
    let renderTask: pdfjs.RenderTask | null = null

    async function renderPdf() {
      const canvas = pdfCanvasRef.current
      if (!canvas || !pdfDoc) return

      const page = await pdfDoc.getPage(pageNum)
      if (cancelled) return

      const viewport = page.getViewport({ scale })
      const context = canvas.getContext('2d')
      if (!context) return

      const w = Math.floor(viewport.width)
      const h = Math.floor(viewport.height)
      canvas.width = w
      canvas.height = h

      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise

      const overlay = overlayRef.current
      if (overlay && !cancelled) {
        overlay.width = w
        overlay.height = h
        const octx = overlay.getContext('2d')
        if (octx) redrawOverlay(octx, w, h, strokesRef.current)
      }
    }

    renderPdf().catch(() => {})

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdfDoc, pageNum, scale])

  useEffect(() => {
    const overlay = overlayRef.current
    const pdfCanvas = pdfCanvasRef.current
    if (!overlay || !pdfCanvas) return
    const octx = overlay.getContext('2d')
    if (!octx) return
    redrawOverlay(octx, overlay.width, overlay.height, strokes)
  }, [strokes])

  const pushPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const overlay = overlayRef.current
      const stroke = currentStrokeRef.current
      if (!overlay || !stroke) return
      const rect = overlay.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const scaleX = overlay.width / rect.width
      const scaleY = overlay.height / rect.height
      stroke.points.push({ x: x * scaleX, y: y * scaleY })
    },
    [],
  )

  const flushStroke = useCallback(() => {
    const stroke = currentStrokeRef.current
    if (!stroke || stroke.points.length === 0) {
      currentStrokeRef.current = null
      return
    }
    onStrokesChange(pageNum, (prev) => [...prev, stroke])
    currentStrokeRef.current = null
  }, [onStrokesChange, pageNum])

  return (
    <div
      ref={wrapRef}
      id={`pdf-page-${pageNum}`}
      className="relative shrink-0 scroll-mt-24 rounded border border-zinc-700 bg-zinc-900/50 p-2 shadow"
      onPointerDown={() => onFocusPage(pageNum)}
    >
      <div className="mb-1 text-center text-xs text-zinc-500">Page {pageNum}</div>
      <div className="relative inline-block leading-none">
        <canvas ref={pdfCanvasRef} className="block max-w-none rounded-sm bg-white" />
        <canvas
          ref={overlayRef}
          className={`absolute left-0 top-0 block max-w-none rounded-sm ${
            annotateMode ? 'cursor-crosshair touch-none' : 'pointer-events-none'
          }`}
          onPointerDown={(e) => {
            if (!annotateMode) return
            e.currentTarget.setPointerCapture(e.pointerId)
            const overlay = overlayRef.current
            if (!overlay) return
            const rect = overlay.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            const scaleX = overlay.width / rect.width
            const scaleY = overlay.height / rect.height
            currentStrokeRef.current = {
              tool: drawTool,
              lineWidth: penSize,
              points: [{ x: x * scaleX, y: y * scaleY }],
              baseWidth: overlay.width,
              baseHeight: overlay.height,
            }
          }}
          onPointerMove={(e) => {
            if (!annotateMode || !currentStrokeRef.current) return
            pushPoint(e)
            const overlay = overlayRef.current
            const octx = overlay?.getContext('2d')
            const partial = currentStrokeRef.current
            if (!overlay || !octx || partial.points.length < 2) return
            const cw = overlay.width
            const ch = overlay.height
            redrawOverlay(octx, cw, ch, strokesRef.current)
            strokeSingle(octx, cw, ch, partial)
            octx.globalCompositeOperation = 'source-over'
          }}
          onPointerUp={() => flushStroke()}
          onPointerCancel={() => flushStroke()}
        />
      </div>
    </div>
  )
}

export function PdfViewer() {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'empty' })
  const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.1)

  const [scrollDirection, setScrollDirection] = useState<ScrollDirection>('vertical')
  const [annotateMode, setAnnotateMode] = useState(false)
  const [drawTool, setDrawTool] = useState<DrawTool>('pen')
  const [penSize, setPenSize] = useState(4)
  const [drawingsByPage, setDrawingsByPage] = useState<DrawingsByPage>({})

  const [query, setQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState<string>('')
  const [pageTextCache, setPageTextCache] = useState<Record<number, string>>({})

  const [scrollIntoViewTick, setScrollIntoViewTick] = useState(0)

  const canGoPrev = pageNumber > 1
  const canGoNext = numPages > 0 && pageNumber < numPages

  const zoomLabel = useMemo(() => `${Math.round(scale * 100)}%`, [scale])

  const bumpScrollIntoView = useCallback(() => {
    setScrollIntoViewTick((t) => t + 1)
  }, [])

  const setPageAndScroll = useCallback((p: number) => {
    setPageNumber(p)
    queueMicrotask(() => bumpScrollIntoView())
  }, [bumpScrollIntoView])

  const onFocusPage = useCallback((p: number) => {
    setPageNumber(p)
  }, [])

  const onStrokesChange = useCallback(
    (pageNum: number, updater: Stroke[] | ((prev: Stroke[]) => Stroke[])) => {
      setDrawingsByPage((prev) => {
        const cur = prev[pageNum] ?? []
        const next = typeof updater === 'function' ? updater(cur) : updater
        return { ...prev, [pageNum]: next }
      })
    },
    [],
  )

  async function onPickFile(file: File) {
    setLoadState({ kind: 'loading' })
    setSearchStatus('')
    setPageTextCache({})
    setDrawingsByPage({})
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
          setPageAndScroll(p)
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

  function clearDrawingsPage() {
    setDrawingsByPage((prev) => ({ ...prev, [pageNumber]: [] }))
  }

  function clearDrawingsAll() {
    setDrawingsByPage({})
  }

  const pageIndices = useMemo(
    () => (numPages > 0 ? Array.from({ length: numPages }, (_, i) => i + 1) : []),
    [numPages],
  )

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
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
              <span className="max-w-[16rem] truncate text-zinc-400">{loadState.name}</span>
            ) : null}
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!pdfDoc || !canGoPrev}
              onClick={() => setPageAndScroll(pageNumber - 1)}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!pdfDoc || !canGoNext}
              onClick={() => setPageAndScroll(pageNumber + 1)}
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

          <div
            className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-xs"
            title="Page layout"
          >
            <button
              type="button"
              disabled={!pdfDoc}
              onClick={() => setScrollDirection('vertical')}
              className={`rounded px-2 py-1 disabled:opacity-40 ${
                scrollDirection === 'vertical' ? 'bg-amber-500/20 text-amber-200' : 'text-zinc-400'
              }`}
            >
              Vertical
            </button>
            <button
              type="button"
              disabled={!pdfDoc}
              onClick={() => setScrollDirection('horizontal')}
              className={`rounded px-2 py-1 disabled:opacity-40 ${
                scrollDirection === 'horizontal'
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'text-zinc-400'
              }`}
            >
              Horizontal
            </button>
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

          <div className="flex w-full flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-2 sm:border-0 sm:pt-0">
            <span className="text-xs text-zinc-500">Draw</span>
            <button
              type="button"
              disabled={!pdfDoc}
              onClick={() => setAnnotateMode((v) => !v)}
              className={`rounded-md border px-2 py-1 text-xs disabled:opacity-40 ${
                annotateMode
                  ? 'border-amber-600 bg-amber-950/50 text-amber-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300'
              }`}
            >
              {annotateMode ? 'Annotate on' : 'Annotate off'}
            </button>
            <button
              type="button"
              disabled={!pdfDoc || !annotateMode}
              onClick={() => setDrawTool('pen')}
              className={`rounded-md border px-2 py-1 text-xs disabled:opacity-40 ${
                drawTool === 'pen' && annotateMode
                  ? 'border-amber-600 bg-amber-950/40 text-amber-100'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              Pen
            </button>
            <button
              type="button"
              disabled={!pdfDoc || !annotateMode}
              onClick={() => setDrawTool('eraser')}
              className={`rounded-md border px-2 py-1 text-xs disabled:opacity-40 ${
                drawTool === 'eraser' && annotateMode
                  ? 'border-amber-600 bg-amber-950/40 text-amber-100'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400'
              }`}
            >
              Eraser
            </button>
            <label className="flex items-center gap-1 text-xs text-zinc-400">
              Size
              <input
                type="range"
                min={2}
                max={24}
                value={penSize}
                onChange={(e) => setPenSize(Number(e.target.value))}
                disabled={!pdfDoc || !annotateMode}
                className="w-20 accent-amber-500 disabled:opacity-40"
              />
              <span className="w-4 tabular-nums text-zinc-300">{penSize}</span>
            </label>
            <button
              type="button"
              disabled={!pdfDoc}
              onClick={clearDrawingsPage}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 disabled:opacity-40"
            >
              Clear page
            </button>
            <button
              type="button"
              disabled={!pdfDoc}
              onClick={clearDrawingsAll}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 disabled:opacity-40"
            >
              Clear all
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
            {searchStatus ? <span className="text-xs text-zinc-400">{searchStatus}</span> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-3 px-3 py-6">
        {loadState.kind === 'empty' ? (
          <div className="w-full rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-left">
            <div className="text-lg font-semibold text-zinc-100">Local PDF Viewer</div>
            <div className="mt-1 text-sm text-zinc-400">
              Click <span className="text-zinc-200">Open PDF</span> to load a file from your
              computer. Use <span className="text-zinc-200">Vertical</span> /{' '}
              <span className="text-zinc-200">Horizontal</span> to change scroll direction. Turn on{' '}
              <span className="text-zinc-200">Annotate</span> to draw on pages (stored in memory
              only).
            </div>
          </div>
        ) : null}

        {loadState.kind === 'loading' ? <div className="text-sm text-zinc-400">Loading…</div> : null}

        {loadState.kind === 'error' ? (
          <div className="w-full rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
            {loadState.message}
          </div>
        ) : null}

        {pdfDoc && numPages > 0 ? (
          <div
            className={`w-full overflow-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 ${
              scrollDirection === 'vertical'
                ? 'max-h-[calc(100vh-11rem)]'
                : 'max-h-[calc(100vh-11rem)] overflow-x-auto'
            }`}
          >
            <div
              className={
                scrollDirection === 'vertical'
                  ? 'flex flex-col items-center gap-6'
                  : 'flex min-h-min flex-row flex-nowrap items-start gap-6'
              }
            >
              {pageIndices.map((pn) => (
                <PdfPageBlock
                  key={pn}
                  pageNum={pn}
                  pdfDoc={pdfDoc}
                  scale={scale}
                  strokes={drawingsByPage[pn] ?? []}
                  onStrokesChange={onStrokesChange}
                  annotateMode={annotateMode}
                  drawTool={drawTool}
                  penSize={penSize}
                  scrollTick={scrollIntoViewTick}
                  focusedPage={pageNumber}
                  onFocusPage={onFocusPage}
                />
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
