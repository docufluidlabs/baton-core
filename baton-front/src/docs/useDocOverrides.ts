/**
 * FluidLabs-published documentation overrides for the docs reader.
 *
 * Mirrors useCatalog.ts: a plain unauthenticated fetch (the docs are public) to
 * the public endpoint GET /api/public/doc-content. Returns a map of slug →
 * edited Markdown; when a slug is present, the reader renders that Markdown
 * instead of the hardcoded TSX page (see DocsApp `DocPage`).
 */
import useSWR from 'swr';

export interface DocOverrideEntry {
  contentMarkdown: string;
  version: number;
  updatedAt: string;
}

const publicFetcher = async (url: string): Promise<{ overrides: Record<string, DocOverrideEntry> }> => {
  // Bypass the HTTP cache so a just-published edit is never masked by a stale
  // cached response when SWR revalidates after a save.
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Doc content request failed (${res.status})`);
  return res.json();
};

export function useDocOverrides() {
  return useSWR<{ overrides: Record<string, DocOverrideEntry> }>(
    '/api/public/doc-content',
    publicFetcher,
    { revalidateOnFocus: false },
  );
}
