/**
 * Baton docs — full-screen reader chrome (top bar, sidebar, on-this-page TOC,
 * breadcrumb, prev/next). Public and auth-agnostic: it renders no API/Clerk
 * calls, so the docs work signed-in or signed-out. The active page (or section
 * overview) component is passed as `children`.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Menu, Search } from 'lucide-react';
import { GROUPS, DOC_ORDER, META_BY_SLUG, GROUP_BY_SLUG } from './registry';
import { SearchModal } from './SearchModal';
import { slugify } from './slug';

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export function DocsLayout({
  slug,
  kind = 'page',
  subTitle,
  contentKey,
  children,
}: {
  slug: string;
  kind?: 'page' | 'section';
  /** Leaf crumb for a sub-page (e.g. a single platform under "Setup guides"). */
  subTitle?: string;
  /** Changes when the rendered body swaps (e.g. TSX → Markdown override), so the
   *  on-this-page TOC rebuilds from the new headings rather than going stale. */
  contentKey?: string | number;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const pageMeta = kind === 'page' ? META_BY_SLUG[slug] : undefined;
  const sectionMeta = kind === 'section' ? GROUP_BY_SLUG[slug] : undefined;
  const activeGroupSlug = kind === 'section' ? slug : pageMeta?.groupSlug;

  const idx = kind === 'page' ? DOC_ORDER.findIndex((p) => p.slug === slug) : -1;
  const prev = idx > 0 ? DOC_ORDER[idx - 1] : null;
  const next = idx >= 0 && idx < DOC_ORDER.length - 1 ? DOC_ORDER[idx + 1] : null;

  // Per-page browser tab title (was the generic SPA title on every docs page).
  const docTitle =
    kind === 'section'
      ? sectionMeta?.title
      : subTitle
        ? `${subTitle} — ${pageMeta?.title ?? ''}`.trim()
        : pageMeta?.title;
  useEffect(() => {
    document.title = docTitle ? `${docTitle} · Baton User Guide` : 'Baton User Guide';
    return () => {
      document.title = 'Baton — Workflow Orchestration';
    };
  }, [docTitle]);

  // Build the on-this-page TOC + scrollspy after each page renders, and honour
  // an incoming #hash (deep links from search or shared URLs).
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const headings = Array.from(
      root.querySelectorAll<HTMLHeadingElement>('.docs-prose h2, .docs-prose h3'),
    ).filter((h) => !h.closest('.card')); // card titles are not page sections
    const seen = new Set<string>();
    const items: TocItem[] = headings.map((h) => {
      let id = h.id || slugify(h.textContent || '');
      while (seen.has(id)) id += '-x';
      seen.add(id);
      h.id = id;
      return { id, text: h.textContent || '', level: h.tagName === 'H3' ? 3 : 2 };
    });
    setToc(items);
    setActiveId(items[0]?.id ?? '');

    // Scroll to the hash target, or to the top of a fresh page.
    const hashId = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
    const target = hashId ? root.querySelector<HTMLElement>(`#${CSS.escape(hashId)}`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else root.scrollTop = 0;

    if (!('IntersectionObserver' in window) || headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) setActiveId((en.target as HTMLElement).id);
        });
      },
      { root, rootMargin: '0px 0px -72% 0px', threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [slug, kind, location.key, contentKey]);

  // Global shortcuts: ⌘K / Ctrl+K or "/" opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isTyping = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName || '');
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '/' && !isTyping && !searchOpen) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  function scrollTo(id: string) {
    const root = contentRef.current;
    const el = root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const showBreadcrumb =
    (kind === 'page' && slug !== 'welcome' && pageMeta) || (kind === 'section' && sectionMeta);

  return (
    <div className="baton-docs">
      {/* Top bar */}
      <header className="bd-topbar">
        <button className="bd-iconbtn" aria-label="Toggle navigation" onClick={() => setMenuOpen((v) => !v)}>
          <Menu />
        </button>
        <Link className="bd-brand" to="/docs">
          <svg className="bd-mark" viewBox="0 0 223.96 287.65" aria-hidden="true">
            <path d="M42.5,220.14L1.09,89.14c-3.89-12.35,2.95-25.55,15.33-29.46,7.71-2.44,15.77-.69,21.69,4.04v127.86c0,9.94,1.5,19.5,4.39,28.56Z" fill="#FCCD63" />
            <path d="M148.76,50.43l-24.32,45.61c-14.29,1.57-27.68,6.27-39.4,13.29v-39.15l22.32-41.85c6.08-11.44,20.31-15.77,31.75-9.65,11.44,6.08,15.77,20.31,9.65,31.75Z" fill="#FF5252" />
            <path d="M221.07,237.16c-17.05,31.16-49.9,50.5-85.67,50.5-29.56,0-56.11-13.07-73.94-33.76-6.46-7.43-11.79-15.83-15.67-24.95-.63-1.44-1.19-2.88-1.76-4.36-.03-.06-.03-.13-.06-.19-.53-1.41-1.03-2.85-1.47-4.26-2.88-9.06-4.39-18.62-4.39-28.56V23.48C38.11,10.5,48.61,0,61.55,0s23.48,10.5,23.48,23.48v85.85c11.72-7.02,25.11-11.72,39.4-13.29,3.6-.41,7.27-.63,10.97-.63,35.76,0,68.61,19.37,85.67,50.53,6.24,11.38,2.04,25.64-9.37,31.88-11.35,6.21-25.64,2.01-31.81-9.34-8.81-16.11-25.83-26.08-44.48-26.08-27.71,0-50.25,21.91-50.37,48.96v.28c.03,4.39.6,8.68,1.72,12.76.22.75.44,1.5.69,2.23.19.6.41,1.19.63,1.79.34.94.72,1.85,1.13,2.73,7.77,17.37,25.51,29.59,46.2,29.59,18.65,0,35.67-10,44.48-26.08,6.21-11.41,20.47-15.61,31.81-9.37,11.41,6.24,15.61,20.47,9.37,31.88Z" fill="#05162B" />
          </svg>
          Baton <small>User Guide</small>
        </Link>
        <div className="bd-spacer" />
        <button className="bd-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search documentation">
          <Search />
          <span>Search the docs…</span>
          <kbd>⌘K</kbd>
        </button>
        <Link className="bd-back" to="/flows">
          <ArrowLeft />
          <span>Back to Baton</span>
        </Link>
      </header>

      <div className="bd-shell">
        {/* Sidebar */}
        <nav className={`bd-sidebar${menuOpen ? ' open' : ''}`} aria-label="Documentation">
          {GROUPS.map((g) => (
            <div className="bd-group" key={g.slug}>
              <Link
                to={`/docs/section/${g.slug}`}
                className={`bd-group-title${g.slug === activeGroupSlug ? ' is-active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                {g.title}
              </Link>
              {g.items.map((it) => (
                <Link
                  key={it.slug}
                  to={`/docs/${it.slug}`}
                  className={`bd-link${kind === 'page' && it.slug === slug ? ' is-active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {it.title}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* Content */}
        <div className="bd-content" ref={contentRef}>
          <article className="docs-prose">
            {showBreadcrumb && (
              <nav className="breadcrumb">
                <Link to="/docs">Docs</Link> <span>›</span>{' '}
                {kind === 'page' && pageMeta ? (
                  <>
                    <Link to={`/docs/section/${pageMeta.groupSlug}`}>{pageMeta.groupTitle}</Link> <span>›</span>{' '}
                    {subTitle ? (
                      <>
                        <Link to={`/docs/${slug}`}>{pageMeta.title}</Link> <span>›</span> {subTitle}
                      </>
                    ) : (
                      pageMeta.title
                    )}
                  </>
                ) : (
                  sectionMeta?.title
                )}
              </nav>
            )}

            {children}

            {(prev || next) && !subTitle && (
              <nav className="pager">
                {prev && (
                  <Link className="prev" to={`/docs/${prev.slug}`}>
                    <span className="dir">‹ Previous</span>
                    <span className="ttl">{prev.title}</span>
                  </Link>
                )}
                {next && (
                  <Link className="next" to={`/docs/${next.slug}`}>
                    <span className="dir">Next ›</span>
                    <span className="ttl">{next.title}</span>
                  </Link>
                )}
              </nav>
            )}

            <footer className="docfooter">
              Baton — a webhook command center for Docusign Maestro. Need a hand? Email{' '}
              <a href="mailto:app-support@fluidlabs.com">app-support@fluidlabs.com</a>.
            </footer>
          </article>
        </div>

        {/* On-this-page */}
        <aside className="bd-toc" aria-label="On this page">
          {toc.length > 0 && (
            <>
              <p className="bd-toc-title">On this page</p>
              {toc.map((t) => (
                <a
                  key={t.id}
                  className={`${t.level === 3 ? 'lvl-3' : ''}${t.id === activeId ? ' is-active' : ''}`}
                  href={`#${t.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    scrollTo(t.id);
                  }}
                >
                  {t.text}
                </a>
              ))}
            </>
          )}
        </aside>
      </div>

      {/* Mobile scrim */}
      <div className={`bd-scrim${menuOpen ? ' show' : ''}`} onClick={() => setMenuOpen(false)} />

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
