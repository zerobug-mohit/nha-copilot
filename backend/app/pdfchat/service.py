"""Chat-with-PDFs RAG service.

Builds (and caches) a vector index over the PDF corpus, then answers a question
by retrieving the most relevant chunks and asking the LLM to answer ONLY from
them, citing each fact with a [n] marker. Every [n] is mapped back to its source
chunk's {pdf, page, line boxes} so the UI can open that PDF at that page and
highlight the exact cited line(s).
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.config import get_settings
from app.nl_to_sql.client import get_llm_client
from app.pdfchat.ingest import extract_chunks
from app.pdfchat.source import get_pdf_source
from app.pdfchat.store import VectorStore

logger = logging.getLogger(__name__)

_store: VectorStore | None = None
TOP_K = 8
# Bump when the chunk/box format changes so the on-disk cache is rebuilt.
INDEX_VERSION = 2

_SYSTEM = (
    "You answer questions using ONLY the numbered SOURCES provided (excerpts from "
    "PDF documents). Rules:\n"
    "- Base every statement strictly on the sources. Do NOT use outside knowledge.\n"
    "- After each fact, cite the source it came from with its number in square "
    "brackets, e.g. [2]. Cite every sentence that uses a source. You may cite more "
    "than one, e.g. [1][3].\n"
    "- If the sources do not contain the answer, say so plainly and set found=false.\n"
    "- Be concise and factual. Mirror the user's language (English/Hindi/Hinglish).\n"
    'Return JSON: {"answer": "<answer text with [n] citation markers>", '
    '"found": true|false}.'
)


def _index_path():
    return get_settings().pdf_index_path / "index.json"


def _fingerprint(src) -> str:
    s = get_settings()
    return f"v{INDEX_VERSION}|{src.corpus_fingerprint()}|{s.openai_embedding_model}"


def get_index(force: bool = False) -> VectorStore:
    """Load the cached index if current, else (re)build and cache it."""
    global _store
    src = get_pdf_source()
    want_fp = _fingerprint(src)

    if not force and _store is not None and _store.meta.get("fingerprint") == want_fp:
        return _store

    if not force:
        cached = VectorStore.load(_index_path())
        if cached and cached.meta.get("fingerprint") == want_fp:
            _store = cached
            return _store

    _store = _build(src, want_fp)
    return _store


def _build(src, fingerprint: str) -> VectorStore:
    llm = get_llm_client()
    all_chunks: list[dict[str, Any]] = []
    for ref in src.list_pdfs():
        try:
            data = src.read_bytes(ref.id)
            chunks = extract_chunks(ref.id, ref.name, data)
            all_chunks.extend(c.to_dict() for c in chunks)
            logger.info("Ingested %s: %d chunks", ref.name, len(chunks))
        except Exception:  # noqa: BLE001
            logger.warning("Failed to ingest %s", ref.name, exc_info=True)

    embeddings: list[list[float]] = []
    if all_chunks:
        embeddings = llm.embed([c["text"] for c in all_chunks])

    store = VectorStore(chunks=all_chunks, embeddings=embeddings, meta={"fingerprint": fingerprint})
    try:
        store.save(_index_path())
    except Exception:  # noqa: BLE001
        logger.warning("Could not cache PDF index", exc_info=True)
    return store


def list_documents() -> list[dict[str, Any]]:
    """Available PDFs with page counts. Ensures the index is loaded (from cache if
    present) so page counts are populated; a first-ever call with no cache builds it."""
    src = get_pdf_source()
    pages_by_id: dict[str, int] = {}
    try:
        index = get_index()
        for c in index.chunks:
            pages_by_id[c["pdf_id"]] = max(pages_by_id.get(c["pdf_id"], 0), c["page"])
    except Exception:  # noqa: BLE001 - still list the files even if indexing fails
        logger.warning("Index unavailable while listing documents", exc_info=True)
    return [
        {"id": r.id, "name": r.name, "pages": pages_by_id.get(r.id, 0)}
        for r in src.list_pdfs()
    ]


_CITE_RE = re.compile(r"\[(\d+)\]")


def answer(question: str) -> dict[str, Any]:
    question = (question or "").strip()
    if not question:
        return {"answer": "Please ask a question.", "citations": [], "found": False}

    index = get_index()
    if not index.chunks:
        return {
            "answer": "No PDFs are available yet. Add PDFs to the corpus and try again.",
            "citations": [],
            "found": False,
        }

    llm = get_llm_client()
    qvec = llm.embed([question])[0]
    hits = index.search(qvec, k=TOP_K)

    # Numbered sources (1-based) fed to the model.
    sources_block = "\n".join(
        f'[{n}] "{c["text"]}"  (source: {c["pdf_name"]}, page {c["page"]})'
        for n, (c, _score) in enumerate(hits, start=1)
    )
    user = f"SOURCES:\n{sources_block}\n\nQUESTION: {question}"
    try:
        out = llm.generate_json(_SYSTEM, user)
    except Exception:  # noqa: BLE001
        logger.warning("PDF chat generation failed", exc_info=True)
        return {"answer": "I couldn't answer that just now. Please try again.", "citations": [], "found": False}

    answer_text = str(out.get("answer") or "").strip()
    found = bool(out.get("found", True))

    # The [n] markers hold the SOURCE's retrieval rank (1..K). Renumber them to
    # sequential display numbers (1, 2, 3…) in order of first appearance, so a
    # single-source answer shows [1] rather than e.g. [4]. Rewrite the markers in
    # the answer text to match, and drop any that reference a non-existent source.
    display_no: dict[int, int] = {}
    order: list[int] = []
    for m in _CITE_RE.finditer(answer_text):
        n = int(m.group(1))
        if n < 1 or n > len(hits) or n in display_no:
            continue
        display_no[n] = len(order) + 1
        order.append(n)

    def _renumber(m):
        n = int(m.group(1))
        return f"[{display_no[n]}]" if n in display_no else ""

    answer_text = _CITE_RE.sub(_renumber, answer_text).strip()

    used = []
    for old_n in order:
        chunk, score = hits[old_n - 1]
        snippet = chunk["text"]
        used.append({
            "n": display_no[old_n],
            "pdf_id": chunk["pdf_id"],
            "pdf_name": chunk["pdf_name"],
            "page": chunk["page"],
            "page_width": chunk["page_width"],
            "page_height": chunk["page_height"],
            "bbox": chunk["bbox"],
            "lines": chunk["lines"],
            "snippet": (snippet[:200] + "…") if len(snippet) > 200 else snippet,
            "score": round(float(score), 3),
        })

    return {"answer": answer_text, "citations": used, "found": found}
