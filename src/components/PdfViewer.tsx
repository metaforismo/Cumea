import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const CAPABILITY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const MAX_CSS_EDGE = 4_096;
const MAX_CANVAS_EDGE = 8_192;
const MAX_CANVAS_PIXELS = 16_777_216;
const MAX_ACCESSIBLE_TEXT_CHARS = 100_000;

interface CanvasPlan {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  outputScale: number;
}
interface PageText { text: string; truncated: boolean }

export function pdfCapabilityPreviewUrl(token: string): string {
  if (!CAPABILITY_TOKEN.test(token)) throw new Error("Invalid PDF preview capability");
  return `/api/files/${token}/preview`;
}

export function boundedCanvasPlan(width: number, height: number, devicePixelRatio: number): CanvasPlan {
  if (![width, height, devicePixelRatio].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error("This PDF page has invalid dimensions");
  }
  if (width > MAX_CSS_EDGE || height > MAX_CSS_EDGE) throw new Error("This PDF page is too large to render safely at the selected zoom");
  const requestedScale = Math.min(2, Math.max(1, devicePixelRatio));
  const edgeScale = Math.min(MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height);
  const pixelScale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  const outputScale = Math.min(requestedScale, edgeScale, pixelScale);
  const pixelWidth = Math.max(1, Math.floor(width * outputScale));
  const pixelHeight = Math.max(1, Math.floor(height * outputScale));
  if (pixelWidth > MAX_CANVAS_EDGE || pixelHeight > MAX_CANVAS_EDGE || pixelWidth * pixelHeight > MAX_CANVAS_PIXELS) {
    throw new Error("This PDF page exceeds the safe canvas limit");
  }
  return { cssWidth: width, cssHeight: height, pixelWidth, pixelHeight, outputScale };
}

export function extractPageText(items: Array<{ str?: unknown; hasEOL?: unknown }>): PageText {
  let text = "";
  let truncated = false;
  for (const item of items) {
    if (typeof item.str !== "string" || !item.str) continue;
    const fragment = `${item.str}${item.hasEOL ? "\n" : " "}`;
    const remaining = MAX_ACCESSIBLE_TEXT_CHARS - text.length;
    if (remaining <= 0) { truncated = true; break; }
    if (fragment.length > remaining) {
      text += fragment.slice(0, remaining);
      truncated = true;
      break;
    }
    text += fragment;
  }
  return { text: text.replace(/[ \t]+\n/g, "\n").trim(), truncated };
}

function friendlyPdfError(reason: unknown, passwordRequested = false): string {
  if (passwordRequested) return "Password-protected PDFs are not supported by the safe preview. Download the file to open it in a trusted app.";
  if (reason instanceof Error) {
    if (reason.name === "InvalidPDFException") return "This file is not a valid PDF.";
    if (reason.name === "MissingPDFException") return "The PDF preview expired or is no longer available.";
    if (reason.name === "UnexpectedResponseException") return "The PDF could not be fetched from the local Cumea host.";
    if (reason.message && !/worker was destroyed|loading aborted/i.test(reason.message)) return reason.message;
  }
  return "Could not prepare this PDF preview.";
}

function isRenderCancellation(reason: unknown): boolean {
  return reason instanceof Error && (reason.name === "RenderingCancelledException" || /rendering cancelled/i.test(reason.message));
}

export function PdfViewer({ token, fileName }: { token: string; fileName: string }) {
  const previewUrl = useMemo(() => pdfCapabilityPreviewUrl(token), [token]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pageText, setPageText] = useState<PageText | null>(null);

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    const controller = new AbortController();
    setPdf(null);
    setLoading(true);
    setLoadError(null);
    setRenderError(null);
    setPageText(null);
    setPageNumber(1);
    setZoom(1);

    void (async () => {
      let passwordRequested = false;
      try {
        const response = await fetch(previewUrl, {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/pdf" },
        });
        const announcedLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(announcedLength) && announcedLength > MAX_PDF_BYTES) throw new Error("PDF preview is limited to 25 MB");
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: unknown };
          throw new Error(typeof body.error === "string" ? body.error : `PDF request failed (${response.status})`);
        }
        if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) throw new Error("The preview endpoint did not return a PDF");
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("PDF preview is limited to 25 MB");
        if (!active || controller.signal.aborted) return;

        const pdfjs = await import("pdfjs-dist");
        if (!active || controller.signal.aborted) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          enableXfa: false,
          stopAtErrors: true,
          maxImageSize: MAX_CANVAS_PIXELS,
          canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
          useWasm: false,
          useWorkerFetch: false,
          isImageDecoderSupported: false,
        });
        loadingTask.onPassword = () => {
          passwordRequested = true;
          void loadingTask?.destroy();
        };
        const documentProxy = await loadingTask.promise;
        if (!active || controller.signal.aborted) {
          await documentProxy.loadingTask.destroy();
          return;
        }
        if (!Number.isInteger(documentProxy.numPages) || documentProxy.numPages < 1) {
          await documentProxy.loadingTask.destroy();
          throw new Error("This PDF contains no readable pages");
        }
        setPdf(documentProxy);
      } catch (reason) {
        if (active && !controller.signal.aborted) setLoadError(friendlyPdfError(reason, passwordRequested));
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      renderTaskRef.current?.cancel();
      void loadingTask?.destroy();
    };
  }, [loadAttempt, previewUrl]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    let page: PDFPageProxy | null = null;
    let ownRenderTask: RenderTask | null = null;
    setRendering(true);
    setRenderError(null);
    setPageText(null);

    void (async () => {
      try {
        const previousTask = renderTaskRef.current;
        if (previousTask) {
          previousTask.cancel();
          await previousTask.promise.catch(() => undefined);
        }
        if (!active) return;
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("PDF canvas is unavailable");
        page = await pdf.getPage(pageNumber);
        if (!active) return;
        const viewport = page.getViewport({ scale: zoom });
        const plan = boundedCanvasPlan(viewport.width, viewport.height, window.devicePixelRatio || 1);
        canvas.width = plan.pixelWidth;
        canvas.height = plan.pixelHeight;
        canvas.style.width = `${Math.floor(plan.cssWidth)}px`;
        canvas.style.height = `${Math.floor(plan.cssHeight)}px`;
        ownRenderTask = page.render({
          canvas,
          viewport,
          transform: plan.outputScale === 1 ? undefined : [plan.outputScale, 0, 0, plan.outputScale, 0, 0],
          background: "rgb(255,255,255)",
        });
        renderTaskRef.current = ownRenderTask;
        await ownRenderTask.promise;
        if (!active) return;
        const textContent = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
        if (!active) return;
        setPageText(extractPageText(textContent.items.filter((item) => "str" in item)));
      } catch (reason) {
        if (active && !isRenderCancellation(reason)) setRenderError(reason instanceof Error ? reason.message : "Could not render this PDF page");
      } finally {
        if (ownRenderTask && renderTaskRef.current === ownRenderTask) renderTaskRef.current = null;
        page?.cleanup();
        if (active) setRendering(false);
      }
    })();
    return () => { active = false; ownRenderTask?.cancel(); };
  }, [pageNumber, pdf, renderAttempt, zoom]);

  const pageCount = pdf?.numPages ?? 0;
  const status = loading ? `Loading ${fileName}` : renderError ? renderError : rendering ? `Rendering page ${pageNumber} of ${pageCount}` : pdf ? `Page ${pageNumber} of ${pageCount} ready` : loadError ?? "PDF preview unavailable";

  if (loadError) return (
    <div className="m-auto max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-5 text-center" role="alert">
      <div className="text-[13px] text-danger">{loadError}</div>
      <button type="button" onClick={() => setLoadAttempt((value) => value + 1)} className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[12px] text-ink hover:bg-raised-hover"><RotateCw size={13} /> Retry</button>
    </div>
  );
  if (loading || !pdf) return <div className="m-auto flex items-center gap-2 text-[13px] text-ink-secondary" role="status"><Loader2 size={16} className="motion-safe:animate-spin" aria-hidden /> Preparing safe PDF preview…</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy={rendering}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{status}</div>
      <div className="flex min-h-12 flex-wrap items-center justify-center gap-1.5 border-b border-hairline/50 bg-card/80 px-3 py-2" role="toolbar" aria-label="PDF page controls">
        <button type="button" onClick={() => setPageNumber((value) => Math.max(1, value - 1))} disabled={pageNumber <= 1} className="rounded-lg p-2 text-ink hover:bg-raised disabled:opacity-35" aria-label="Previous PDF page"><ChevronLeft size={16} /></button>
        <output className="min-w-24 text-center text-[12px] tabular-nums text-ink" aria-live="polite">Page {pageNumber} of {pageCount}</output>
        <button type="button" onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))} disabled={pageNumber >= pageCount} className="rounded-lg p-2 text-ink hover:bg-raised disabled:opacity-35" aria-label="Next PDF page"><ChevronRight size={16} /></button>
        <span className="mx-1 h-5 w-px bg-hairline/60" aria-hidden />
        <button type="button" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))} disabled={zoom <= MIN_ZOOM} className="rounded-lg p-2 text-ink hover:bg-raised disabled:opacity-35" aria-label="Zoom out PDF"><ZoomOut size={16} /></button>
        <output className="min-w-12 text-center text-[12px] tabular-nums text-ink">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))} disabled={zoom >= MAX_ZOOM} className="rounded-lg p-2 text-ink hover:bg-raised disabled:opacity-35" aria-label="Zoom in PDF"><ZoomIn size={16} /></button>
        <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1} className="flex items-center gap-1 rounded-lg px-2 py-2 text-[12px] text-ink hover:bg-raised disabled:opacity-35" aria-label="Reset PDF zoom to 100 percent"><RotateCcw size={14} /> Reset</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-raised/40 px-4 py-6">
        {renderError ? (
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-danger/30 bg-danger/10 p-5 text-center" role="alert">
            <div className="text-[13px] text-danger">{renderError}</div>
            <button type="button" onClick={() => setRenderAttempt((value) => value + 1)} className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg bg-raised px-3 py-2 text-[12px] text-ink hover:bg-raised-hover"><RotateCw size={13} /> Retry page</button>
          </div>
        ) : (
          <div className="mx-auto w-max max-w-full">
            <div className="relative overflow-hidden rounded-sm bg-white shadow-lg">
              <canvas ref={canvasRef} role="img" aria-label={`PDF page ${pageNumber} of ${pageCount}. A text reading option follows the page.`} className="block max-w-none" />
              {rendering && <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-[12px] text-neutral-700" role="status"><Loader2 size={15} className="mr-2 motion-safe:animate-spin" aria-hidden /> Rendering page…</div>}
            </div>
            <details className="mt-4 max-w-[48rem] rounded-xl border border-hairline/60 bg-card px-4 py-3 text-ink">
              <summary className="cursor-pointer text-[12px] font-medium">Read current page as text</summary>
              <div className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-[13px] leading-6 text-ink-secondary">{pageText ? pageText.text || "No extractable text was found on this page. The page may contain only images." : "Extracting accessible text for this page…"}</div>
              {pageText?.truncated && <p className="mt-2 text-[11px] text-warning">The text alternative was truncated at 100,000 characters.</p>}
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
