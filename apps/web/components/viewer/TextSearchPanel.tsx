'use client';

/**
 * TextSearchPanel — floating search dock anchored top-right of the canvas.
 *
 * - PDF: scans rendered pages' text content via the engine's searchText().
 * - DXF: scans the raw DXF source for TEXT/MTEXT (group code 1) entities.
 *   This is best-effort because dxf-viewer doesn't expose a high-level entity
 *   query — Phase 1 does the scan once on first open and caches the results.
 *
 * Visual:
 *   ┌──────────────────────────────────────┐
 *   │ [🔍 search box]  [< 3/12 >]  [✕]      │
 *   ├──────────────────────────────────────┤
 *   │ p.2  ...수문 차폐 두께 측정용 라인...   │
 *   │ p.4  ...                              │
 *   └──────────────────────────────────────┘
 */

import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type { PdfRenderer, PdfSearchHit } from '@/lib/viewer/pdf-engine';
import { useViewerStore } from '@/lib/viewer/use-viewer-state';

export interface TextSearchPanelProps {
  /** PDF renderer when mode === 'pdf'. */
  pdfRenderer: PdfRenderer | null;
  /** Raw DXF text when mode === 'dxf' (used for naive entity scan). */
  dxfText: string | null;
  /** Jump to a hit — engine-specific (set page in PDF, focus camera in DXF). */
  onJump: (hit: SearchHit) => void;
}

export interface SearchHit {
  /** Page (PDF) or 1 for DXF. */
  page: number;
  snippet: string;
  /** PDF: char index. DXF: char offset within full text. */
  charIndex: number;
}

export function TextSearchPanel({
  pdfRenderer,
  dxfText,
  onJump,
}: TextSearchPanelProps) {
  const open = useViewerStore((s) => s.searchOpen);
  const setOpen = useViewerStore((s) => s.setSearchOpen);
  const query = useViewerStore((s) => s.searchQuery);
  const setQuery = useViewerStore((s) => s.setSearchQuery);
  const setHits = useViewerStore((s) => s.setSearchHits);
  const idx = useViewerStore((s) => s.searchIndex);
  const setIdx = useViewerStore((s) => s.setSearchIndex);
  const mode = useViewerStore((s) => s.mode);

  const [results, setResults] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  // Run the search whenever the query changes (debounced).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setHits(0);
      setIdx(0);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const hits =
          mode === 'pdf' && pdfRenderer
            ? await searchPdf(pdfRenderer, q)
            : mode === 'dxf' && dxfText
              ? searchDxfText(dxfText, q)
              : [];
        if (cancelled) return;
        setResults(hits);
        setHits(hits.length);
        setIdx(hits.length > 0 ? 1 : 0);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, mode, pdfRenderer, dxfText, setHits, setIdx]);

  const current = useMemo(
    () => (idx > 0 ? results[idx - 1] ?? null : null),
    [idx, results],
  );
  useEffect(() => {
    if (current) onJump(current);
    // We deliberately omit onJump from deps — the parent rebinds it on
    // every render which would re-fire the effect on every key press.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.page, current?.charIndex]);

  if (!open) return null;

  const goPrev = () => {
    if (results.length === 0) return;
    setIdx(idx <= 1 ? results.length : idx - 1);
  };
  const goNext = () => {
    if (results.length === 0) return;
    setIdx(idx >= results.length ? 1 : idx + 1);
  };

  return (
    <div
      role="search"
      aria-label="문자 검색"
      className="absolute right-3 top-3 z-20 w-[24rem] rounded-md border border-border bg-bg-subtle shadow-lg"
    >
      <div className="flex items-center gap-1 border-b border-border p-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === 'pdf' ? '문자 검색…' : 'DXF 텍스트 검색…'}
          prefix={<Search />}
          className="h-7 text-xs"
          aria-label="검색어"
        />
        <button
          type="button"
          onClick={goPrev}
          aria-label="이전 결과"
          className="rounded p-1 text-fg-muted hover:bg-bg-muted disabled:opacity-40"
          disabled={results.length === 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[3rem] text-center font-mono text-xs text-fg-muted">
          {results.length === 0
            ? busy
              ? '…'
              : '0/0'
            : `${idx}/${results.length}`}
        </span>
        <button
          type="button"
          onClick={goNext}
          aria-label="다음 결과"
          className="rounded p-1 text-fg-muted hover:bg-bg-muted disabled:opacity-40"
          disabled={results.length === 0}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="검색 닫기"
          className="rounded p-1 text-fg-muted hover:bg-bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {results.length > 0 ? (
        <ul
          role="listbox"
          className="max-h-64 divide-y divide-border overflow-y-auto"
        >
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => setIdx(i + 1)}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs',
                  i + 1 === idx
                    ? 'bg-bg-muted text-fg'
                    : 'text-fg-muted hover:bg-bg-muted hover:text-fg',
                )}
              >
                <span className="shrink-0 font-mono">
                  {mode === 'pdf' ? `p.${r.page}` : '·'}
                </span>
                <span className="truncate">{r.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <div className="p-3 text-xs text-fg-muted">
          {busy ? '검색 중…' : '결과 없음'}
        </div>
      ) : (
        <div className="p-3 text-xs text-fg-muted">검색어를 입력하세요.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search implementations
// ---------------------------------------------------------------------------

async function searchPdf(
  renderer: PdfRenderer,
  query: string,
): Promise<SearchHit[]> {
  const hits = await renderer.searchText(query);
  return hits.map((h: PdfSearchHit) => ({
    page: h.page,
    snippet: h.snippet,
    charIndex: h.charIndex,
  }));
}

/**
 * DXF source scan — group code "1" carries TEXT/MTEXT string content.
 * We walk the file looking for TEXT/MTEXT/ATTDEF entity blocks and capture
 * their group-1 value. Cheap-but-effective: avoids loading a parser.
 */
function searchDxfText(source: string, query: string): SearchHit[] {
  const lower = query.toLowerCase();
  const lines = source.split(/\r?\n/);
  const hits: SearchHit[] = [];
  let inTextEntity = false;
  let entityStart = 0;

  for (let i = 0; i < lines.length - 1; i++) {
    const code = lines[i]!.trim();
    const value = lines[i + 1] ?? '';

    if (code === '0') {
      const next = value.trim().toUpperCase();
      inTextEntity = next === 'TEXT' || next === 'MTEXT' || next === 'ATTDEF';
      entityStart = i;
    } else if (inTextEntity && code === '1') {
      // Group code 1 = primary text. MTEXT may also have continuation in code 3.
      if (value.toLowerCase().includes(lower)) {
        const start = Math.max(0, value.toLowerCase().indexOf(lower) - 24);
        const end = Math.min(
          value.length,
          value.toLowerCase().indexOf(lower) + query.length + 24,
        );
        hits.push({
          page: 1,
          snippet:
            (start > 0 ? '…' : '') +
            value.slice(start, end) +
            (end < value.length ? '…' : ''),
          charIndex: entityStart,
        });
      }
    }
  }
  return hits;
}
