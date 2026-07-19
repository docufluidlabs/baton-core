/**
 * Baton docs — client-side full-text search.
 *
 * The index is built lazily the first time the user opens search: each static
 * page component is rendered to static markup, stripped to plain text, and its
 * h2/h3 headings captured for deep-link results. Because it indexes the real
 * components, it never drifts from the content. `react-dom/server` is imported
 * dynamically so it stays out of the initial bundle.
 */
import { createElement, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { GROUPS } from './registry';
import { DOC_COMPONENTS } from './pages';
import { slugify } from './slug';

export interface SearchResult {
  /** Route under /docs, e.g. "flow-builder", "section/connect", "setup". */
  slug: string;
  title: string;
  group: string;
  headingId?: string;
  headingText?: string;
  snippet: string;
  score: number;
}

interface IndexEntry {
  slug: string;
  title: string;
  group: string;
  text: string;
  lowerText: string;
  headings: { id: string; text: string }[];
}

let INDEX: IndexEntry[] | null = null;
let building: Promise<IndexEntry[]> | null = null;

export function ensureIndex(): Promise<IndexEntry[]> {
  if (INDEX) return Promise.resolve(INDEX);
  if (!building) building = build();
  return building;
}

/** Synchronous access to the already-built index (null until `ensureIndex` resolves). */
export function getIndex(): IndexEntry[] | null {
  return INDEX;
}

async function build(): Promise<IndexEntry[]> {
  const { renderToStaticMarkup } = await import('react-dom/server');

  const parse = (node: ReactElement): { text: string; headings: { id: string; text: string }[] } => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, node));
    // Insert a space before block-closing tags so adjacent blocks don't run
    // together in the extracted text (e.g. "screen.Resolution Center").
    const spaced = html.replace(
      /(<\/(?:p|li|h1|h2|h3|h4|td|th|dt|dd|div|section|tr|article|pre|blockquote|span)>|<br\s*\/?>)/gi,
      ' $1',
    );
    const doc = new DOMParser().parseFromString(spaced, 'text/html');
    const headings = Array.from(doc.querySelectorAll('h2, h3')).map((h) => ({
      id: slugify(h.textContent || ''),
      text: (h.textContent || '').trim(),
    }));
    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    return { text, headings };
  };

  // Rendering with the server renderer inside the browser makes React Router's
  // useLayoutEffect emit a dev-only "does nothing on the server" warning. We
  // only read text out of the markup (never hydrate), so silence just that one
  // warning while the index builds, then restore console.error.
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    origError(...args);
  };

  const entries: IndexEntry[] = [];
  try {
    for (const group of GROUPS) {
      for (const it of group.items) {
        const Comp = DOC_COMPONENTS[it.slug];
        if (Comp) {
          const { text, headings } = parse(createElement(Comp));
          entries.push({ slug: it.slug, title: it.title, group: group.title, text, lowerText: text.toLowerCase(), headings });
        } else {
          // Dynamic page (e.g. Setup guides) — index by its metadata.
          const text = `${it.title}. ${it.description}`;
          entries.push({ slug: it.slug, title: it.title, group: group.title, text, lowerText: text.toLowerCase(), headings: [] });
        }
      }
      // Section overview page.
      const secText = `${group.title}. ${group.intro} ${group.items.map((i) => `${i.title} ${i.description}`).join(' ')}`;
      entries.push({
        slug: `section/${group.slug}`,
        title: group.title,
        group: group.title,
        text: secText,
        lowerText: secText.toLowerCase(),
        headings: [],
      });
    }
  } finally {
    console.error = origError;
  }

  INDEX = entries;
  return entries;
}

function makeSnippet(text: string, lower: string, q: string, terms: string[]): string {
  let pos = lower.indexOf(q);
  if (pos === -1) {
    for (const t of terms) {
      const p = lower.indexOf(t);
      if (p !== -1) { pos = p; break; }
    }
  }
  if (pos === -1) pos = 0;
  const start = Math.max(0, pos - 64);
  const end = Math.min(text.length, pos + 96);
  let s = text.slice(start, end).trim();
  if (start > 0) s = '…' + s;
  if (end < text.length) s = s + '…';
  return s;
}

export function searchDocs(index: IndexEntry[], query: string, limit = 8): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const out: SearchResult[] = [];

  for (const e of index) {
    const titleLower = e.title.toLowerCase();
    let score = 0;

    if (titleLower === q) score += 80;
    else if (titleLower.includes(q)) score += 50;
    terms.forEach((t) => { if (titleLower.includes(t)) score += 14; });

    let headingHit: { id: string; text: string } | undefined;
    for (const h of e.headings) {
      const hl = h.text.toLowerCase();
      if (hl.includes(q)) { score += 26; headingHit = h; break; }
      if (terms.length > 1 && terms.every((t) => hl.includes(t))) { score += 12; headingHit = headingHit ?? h; }
    }

    if (e.lowerText.includes(q)) score += 8;
    let bodyHits = 0;
    terms.forEach((t) => { if (e.lowerText.includes(t)) bodyHits++; });
    score += bodyHits * 3;

    if (score <= 0) continue;
    out.push({
      slug: e.slug,
      title: e.title,
      group: e.group,
      headingId: headingHit?.id,
      headingText: headingHit?.text,
      snippet: makeSnippet(e.text, e.lowerText, q, terms),
      score,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
