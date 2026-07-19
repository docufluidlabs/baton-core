/**
 * DocMarkdown — renders a FluidLabs-edited doc page from stored Markdown.
 *
 * Used by DocsApp when a slug has a published override. Output elements land
 * inside the parent `<article className="docs-prose">`, so they inherit the docs
 * typography and the TOC scrollspy picks up the headings automatically.
 *
 * Beyond GFM Markdown it supports two directive shortcodes so an edited page
 * keeps the things Markdown can't express:
 *   - `::demo[filter-tabs]`  → the live interactive demo of that name
 *   - `:::note[Title] … :::` → a Callout (types: note/tip/warning/danger)
 * and renders Markdown images (`![alt](src "caption")`) as the zoomable
 * Screenshot component.
 *
 * rehype-sanitize strips unsafe HTML/attributes the editor might paste — defense
 * in depth alongside the server-side write gate. The schema is widened only for
 * the two trusted custom tags and their fixed attributes.
 */
import { Link } from 'react-router-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { toString as mdToString } from 'mdast-util-to-string';
import { Callout, Screenshot } from './ui';
import { DEMO_SHORTCODES } from './shortcodes';

const CALLOUT_TYPES = new Set(['note', 'tip', 'warning', 'danger']);

/** Convert our directive nodes into plain hast elements (<demo>, <callout>). */
function remarkDocDirectives() {
  return (tree: any) => {
    visit(tree, (node: any) => {
      if (
        node.type !== 'containerDirective' &&
        node.type !== 'leafDirective' &&
        node.type !== 'textDirective'
      ) {
        return;
      }

      // ::demo[name]  (or ::demo{name=...})
      if (node.name === 'demo') {
        const label = mdToString(node).trim();
        const name = node.attributes?.name || label;
        node.data = { ...node.data, hName: 'demo', hProperties: { name } };
        node.children = [];
        return;
      }

      // :::note[Title] … :::
      if (CALLOUT_TYPES.has(node.name)) {
        let title: string | undefined;
        // remark-directive marks the optional label paragraph with directiveLabel.
        const first = node.children?.[0];
        if (first?.data?.directiveLabel) {
          title = mdToString(first).trim() || undefined;
          node.children = node.children.slice(1);
        }
        node.data = {
          ...node.data,
          hName: 'callout',
          hProperties: { type: node.name, ...(title ? { title } : {}) },
        };
      }
    });
  };
}

// Allow only the two trusted custom tags (and a title on images for captions).
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'demo', 'callout'],
  attributes: {
    ...defaultSchema.attributes,
    demo: ['name'],
    callout: ['type', 'title'],
    img: [...(defaultSchema.attributes?.img ?? []), 'title'],
  },
};

const components = {
  demo: ({ name }: { name?: string }) => {
    const Comp = name ? DEMO_SHORTCODES[name] : undefined;
    return Comp ? <Comp /> : null;
  },
  callout: ({ type, title, children }: { type?: string; title?: string; children?: React.ReactNode }) => (
    <Callout type={(CALLOUT_TYPES.has(type ?? '') ? type : 'note') as 'note' | 'tip' | 'warning' | 'danger'} title={title}>
      {children}
    </Callout>
  ),
  img: ({ src, alt, title }: { src?: string; alt?: string; title?: string }) => (
    <Screenshot src={src ?? ''} alt={alt ?? ''} caption={title} />
  ),
  // A Markdown image renders as the block <figure> Screenshot, but react-markdown
  // wraps images in a <p> (phrasing content). Unwrap a paragraph whose only child
  // is an image so we don't emit invalid <p><figure> nesting.
  p: ({ node, children }: any) => {
    const onlyImg =
      node?.children?.length === 1 &&
      node.children[0].type === 'element' &&
      node.children[0].tagName === 'img';
    return onlyImg ? <>{children}</> : <p>{children}</p>;
  },
  // Keep internal doc links as SPA navigations; leave external links alone.
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
    href && href.startsWith('/') ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>,
} as Components;

export function DocMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkDirective, remarkDocDirectives]}
      rehypePlugins={[[rehypeSanitize, schema]]}
      components={components}
    >
      {source}
    </ReactMarkdown>
  );
}
