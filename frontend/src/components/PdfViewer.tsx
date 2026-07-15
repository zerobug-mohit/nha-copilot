import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import type { LineBox } from "../api";

// Bundle the pdf.js worker via Vite.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export default function PdfViewer({
  blobUrl,
  docName,
  targetPage,
  highlights,
}: {
  blobUrl: string | null;
  docName?: string;
  targetPage: number;
  highlights: LineBox[]; // coordinates are page FRACTIONS (0..1)
}) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(targetPage || 1);
  const [width, setWidth] = useState(600);
  // Actual rendered page size (CSS px) — highlights are fraction × these.
  const [rendered, setRendered] = useState<{ w: number; h: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);

  // Follow the cited page whenever a new citation is opened.
  useEffect(() => {
    if (targetPage) setPage(targetPage);
  }, [targetPage, blobUrl]);

  // Fit the rendered page to the pane width.
  useLayoutEffect(() => {
    const measure = () => {
      if (wrapRef.current) setWidth(Math.max(280, wrapRef.current.clientWidth - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Scroll the highlight into view after it renders.
  useEffect(() => {
    const t = setTimeout(() => hlRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    return () => clearTimeout(t);
  }, [page, blobUrl, highlights]);

  const onCited = page === targetPage && highlights.length > 0 && !!rendered;

  if (!blobUrl) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-faint">
        Click a citation in an answer to open the source PDF here, at the exact page and line.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-alt px-3 py-1.5">
        <span className="truncate text-[12px] font-medium text-ink" title={docName}>{docName}</span>
        <div className="flex shrink-0 items-center gap-1.5 text-[12px]">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-line px-2 py-0.5 text-ink-muted disabled:opacity-40 hover:border-brand hover:text-brand"
          >‹</button>
          <span className="tabular-nums text-ink-muted">{page} / {numPages || "…"}</span>
          <button
            onClick={() => setPage((p) => Math.min(numPages || p + 1, p + 1))}
            disabled={!!numPages && page >= numPages}
            className="rounded border border-line px-2 py-0.5 text-ink-muted disabled:opacity-40 hover:border-brand hover:text-brand"
          >›</button>
        </div>
      </div>

      {/* Page + highlight overlay */}
      <div ref={wrapRef} className="flex-1 overflow-auto bg-surface-alt/60 p-3">
        <Document
          file={blobUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="p-6 text-sm text-ink-faint">Loading PDF…</div>}
          error={<div className="p-6 text-sm text-danger">Could not load the PDF.</div>}
        >
          <div className="relative mx-auto w-fit shadow-pop">
            <Page
              pageNumber={page}
              width={width}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onRenderSuccess={(p: any) => setRendered({ w: p.width, h: p.height })}
              loading={<div className="p-6 text-sm text-ink-faint">Rendering page…</div>}
            />
            {onCited && rendered && (
              <div className="pointer-events-none absolute inset-0">
                {highlights.map((b, i) => (
                  <div
                    key={i}
                    ref={i === 0 ? hlRef : undefined}
                    className="absolute rounded-sm"
                    style={{
                      left: b.x0 * rendered.w - 2,
                      top: b.top * rendered.h - 1,
                      width: (b.x1 - b.x0) * rendered.w + 4,
                      height: (b.bottom - b.top) * rendered.h + 2,
                      background: "rgba(237, 200, 40, 0.32)",
                      boxShadow: "0 0 0 1px rgba(200, 150, 0, 0.55)",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </Document>
      </div>
    </div>
  );
}
