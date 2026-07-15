"""PDF ingestion: extract per-line text with bounding boxes, then chunk.

Uses pdfplumber. Coordinates are in PDF points with a TOP-LEFT origin (pdfplumber's
`top`/`bottom`), which maps directly to a pdf.js CSS overlay after scaling — so the
frontend can draw a highlight box over the exact cited line(s).

Each chunk carries: the source pdf, 1-based page, page width/height (points), the
joined text, and the list of line boxes it spans — enough to render an exact-line
highlight and to jump the viewer to the right page.
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field, asdict
from typing import Any

logger = logging.getLogger(__name__)

# Chunking: group consecutive lines up to ~these limits (keeps a citation tight
# enough to highlight, big enough to be meaningful for retrieval).
MAX_CHUNK_CHARS = 700
MAX_CHUNK_LINES = 8
LINE_Y_TOLERANCE = 3.0  # words within this many points of `top` are the same line


@dataclass
class LineBox:
    text: str
    x0: float
    top: float
    x1: float
    bottom: float


@dataclass
class Chunk:
    chunk_id: str
    pdf_id: str
    pdf_name: str
    page: int              # 1-based
    page_width: float
    page_height: float
    line_start: int
    line_end: int
    text: str
    bbox: dict[str, float]           # union box {x0, top, x1, bottom}
    lines: list[dict[str, float]] = field(default_factory=list)  # per-line boxes

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _page_lines(page) -> list[LineBox]:
    """Group a page's words into visual lines with bounding boxes."""
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    if not words:
        return []
    words.sort(key=lambda w: (round(float(w["top"]) / LINE_Y_TOLERANCE), float(w["x0"])))
    lines: list[LineBox] = []
    cur: list[dict] = []
    cur_top: float | None = None
    for w in words:
        top = float(w["top"])
        if cur_top is None or abs(top - cur_top) <= LINE_Y_TOLERANCE:
            cur.append(w)
            cur_top = top if cur_top is None else cur_top
        else:
            lines.append(_line_from_words(cur))
            cur = [w]
            cur_top = top
    if cur:
        lines.append(_line_from_words(cur))
    return lines


def _line_from_words(ws: list[dict]) -> LineBox:
    ws = sorted(ws, key=lambda w: float(w["x0"]))
    return LineBox(
        text=" ".join(str(w["text"]) for w in ws).strip(),
        x0=min(float(w["x0"]) for w in ws),
        top=min(float(w["top"]) for w in ws),
        x1=max(float(w["x1"]) for w in ws),
        bottom=max(float(w["bottom"]) for w in ws),
    )


def _union(lines: list[LineBox]) -> dict[str, float]:
    return {
        "x0": min(l.x0 for l in lines),
        "top": min(l.top for l in lines),
        "x1": max(l.x1 for l in lines),
        "bottom": max(l.bottom for l in lines),
    }


def extract_chunks(pdf_id: str, pdf_name: str, data: bytes) -> list[Chunk]:
    """Extract chunks (with line boxes) from a PDF's bytes."""
    import pdfplumber

    chunks: list[Chunk] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            try:
                lines = _page_lines(page)
            except Exception:  # noqa: BLE001 - never let one bad page kill ingestion
                logger.warning("Line extraction failed on %s p%d", pdf_name, pno, exc_info=True)
                continue
            lines = [l for l in lines if l.text]
            i = 0
            while i < len(lines):
                group: list[LineBox] = []
                chars = 0
                start = i
                while i < len(lines) and len(group) < MAX_CHUNK_LINES and (
                    chars + len(lines[i].text) <= MAX_CHUNK_CHARS or not group
                ):
                    group.append(lines[i])
                    chars += len(lines[i].text) + 1
                    i += 1
                text = " ".join(l.text for l in group).strip()
                if not text:
                    continue
                chunks.append(
                    Chunk(
                        chunk_id=f"{pdf_id}:{pno}:{start}",
                        pdf_id=pdf_id,
                        pdf_name=pdf_name,
                        page=pno,
                        page_width=float(page.width),
                        page_height=float(page.height),
                        line_start=start,
                        line_end=i - 1,
                        text=text,
                        bbox=_union(group),
                        lines=[asdict(l) for l in group],
                    )
                )
    return chunks
