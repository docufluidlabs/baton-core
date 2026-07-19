/**
 * Seed-Markdown generator for the docs editor.
 *
 * When a FluidLabs editor opens a page that has no override yet, we give them a
 * faithful Markdown starting point by rendering the canonical TSX component to
 * static HTML (the same trick the search index uses) and converting it with
 * Turndown. Rendering the component — not the live DOM — keeps the page chrome
 * (breadcrumb, sidebar, pager) out of the seed.
 *
 * Custom Turndown rules round-trip the things plain Markdown can't hold:
 *   - `[data-demo="name"]`  → `::demo[name]`        (interactive demos)
 *   - `figure[data-shot]`   → `![alt](src "caption")` (zoomable screenshots)
 *   - `div.callout`         → `:::type[title] … :::`  (callouts)
 * GFM tables/strikethrough are handled by turndown-plugin-gfm. Everything else
 * degrades to clean Markdown text. Heavy deps (react-dom/server, turndown) are
 * imported dynamically so they stay out of the reader's bundle.
 */
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DOC_COMPONENTS } from './pages';

const CALLOUT_TYPES = ['tip', 'warning', 'danger', 'note'];

export async function buildSeedMarkdown(slug: string): Promise<string> {
  const Comp = DOC_COMPONENTS[slug];
  if (!Comp) return '';

  const [{ renderToStaticMarkup }, TurndownMod, gfmMod] = await Promise.all([
    import('react-dom/server'),
    import('turndown'),
    import('turndown-plugin-gfm'),
  ]);
  const TurndownService = TurndownMod.default;
  const gfm = (gfmMod as any).gfm;

  // React Router's useLayoutEffect warns under the server renderer; silence just
  // that one line (we only read markup, never hydrate) — mirrors search.ts.
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    origError(...args);
  };
  let html: string;
  try {
    html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Comp)));
  } finally {
    console.error = origError;
  }

  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  td.use(gfm);

  // Interactive demos → shortcode tokens (their inner HTML is discarded).
  td.addRule('demo', {
    filter: (node) => node.nodeType === 1 && (node as HTMLElement).hasAttribute('data-demo'),
    replacement: (_content, node) =>
      `\n\n::demo[${(node as HTMLElement).getAttribute('data-demo')}]\n\n`,
  });

  // Screenshots → Markdown image with the caption as the title.
  td.addRule('screenshot', {
    filter: (node) =>
      node.nodeName === 'FIGURE' && (node as HTMLElement).hasAttribute('data-shot'),
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const src = el.getAttribute('data-src') || '';
      const alt = el.getAttribute('data-alt') || '';
      const caption = el.getAttribute('data-caption') || '';
      return `\n\n![${alt}](${src}${caption ? ` "${caption}"` : ''})\n\n`;
    },
  });

  // Callouts → :::type[Title] … ::: container directives.
  td.addRule('callout', {
    filter: (node) =>
      node.nodeName === 'DIV' && (node as HTMLElement).classList.contains('callout'),
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const type = CALLOUT_TYPES.find((t) => el.classList.contains(t)) || 'note';
      const clone = el.cloneNode(true) as HTMLElement;
      const titleEl = clone.querySelector('.callout__title');
      const title = titleEl?.textContent?.trim() || '';
      titleEl?.remove();
      const bodyEl = clone.querySelector('.callout__body') ?? clone;
      const bodyMd = td.turndown(bodyEl.innerHTML).trim();
      return `\n\n:::${type}${title ? `[${title}]` : ''}\n${bodyMd}\n:::\n\n`;
    },
  });

  return td.turndown(html).trim() + '\n';
}
