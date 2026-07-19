/**
 * Baton docs — ⌘K command-palette search.
 * Lazily builds the full-text index on first open, then ranks results live with
 * keyboard navigation (↑/↓/Enter/Esc) and term-highlighted snippets.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft } from 'lucide-react';
import { ensureIndex, getIndex, searchDocs, type SearchResult } from './search';

// Critical layout is inlined (not just in docs.css) so the palette can never
// collapse into normal page flow if the scoped stylesheet is momentarily
// missing — e.g. during a dev-server HMR update or a stale cache. docs.css
// still supplies the full visual polish when present.
const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '12vh 16px 16px',
  background: 'rgba(5,13,28,.5)',
};
const BOX_STYLE: CSSProperties = {
  width: '100%',
  maxWidth: 620,
  maxHeight: '72vh',
  display: 'flex',
  flexDirection: 'column',
  background: '#fff',
  border: '1px solid #e7e9ee',
  borderRadius: 14,
  overflow: 'hidden',
  boxShadow: '0 24px 60px rgba(5,13,28,.35)',
};
const INPUT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '13px 16px',
  borderBottom: '1px solid #e7e9ee',
};
const INPUT_STYLE: CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'none',
  fontSize: 16,
  color: '#1f2733',
};
const RESULTS_STYLE: CSSProperties = { overflowY: 'auto', padding: 6 };
const FOOTER_STYLE: CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: '9px 14px',
  borderTop: '1px solid #e7e9ee',
};

function highlight(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text;
  const pattern = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean)
    .join('|');
  if (!pattern) return text;
  const parts = text.split(new RegExp(`(${pattern})`, 'ig'));
  const lowered = terms.map((t) => t.toLowerCase());
  return parts.map((part, i) =>
    lowered.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
  );
}

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  // Build the index when first opened.
  useEffect(() => {
    if (!open || ready) return;
    let cancelled = false;
    ensureIndex().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, [open, ready]);

  // Focus input + reset query each time it opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const results = useMemo<SearchResult[]>(() => {
    const idx = getIndex();
    if (!ready || !idx || !query.trim()) return [];
    return searchDocs(idx, query);
  }, [ready, query]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const go = (r: SearchResult) => {
    navigate(`/docs/${r.slug}${r.headingId ? `#${r.headingId}` : ''}`);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = results[active]; if (r) go(r); }
  };

  return (
    <div className="bd-cmd" style={OVERLAY_STYLE} role="dialog" aria-modal="true" aria-label="Search documentation" onClick={onClose}>
      <div className="bd-cmd__box" style={BOX_STYLE} onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="bd-cmd__input" style={INPUT_ROW_STYLE}>
          <Search />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the documentation…"
            aria-label="Search query"
            style={INPUT_STYLE}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="bd-cmd__results" style={RESULTS_STYLE}>
          {!ready && <p className="bd-cmd__hint">Loading search…</p>}
          {ready && query.trim() === '' && <p className="bd-cmd__hint">Type to search across every page.</p>}
          {ready && query.trim() !== '' && results.length === 0 && (
            <p className="bd-cmd__hint">No matches for “{query}”.</p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.slug}-${i}`}
              className={`bd-cmd__item${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
            >
              <div className="bd-cmd__item-main">
                <span className="bd-cmd__item-title">
                  {highlight(r.title, terms)}
                  {r.headingText && <span className="bd-cmd__item-sub"> › {highlight(r.headingText, terms)}</span>}
                </span>
                <span className="bd-cmd__item-group">{r.group}</span>
              </div>
              <p className="bd-cmd__snippet">{highlight(r.snippet, terms)}</p>
            </button>
          ))}
        </div>

        <div className="bd-cmd__footer" style={FOOTER_STYLE}>
          <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span><kbd><CornerDownLeft size={12} /></kbd> to open</span>
        </div>
      </div>
    </div>
  );
}
