/**
 * DocEditor — FluidLabs Markdown editor for one doc page.
 *
 * A full-screen overlay with a Markdown source pane on the left and a live
 * <DocMarkdown> preview on the right (the preview renders inside `.docs-prose`
 * so it looks exactly like the published page, demos and all). Seeded from the
 * existing override if there is one, otherwise from the page's TSX converted to
 * Markdown (buildSeedMarkdown). Unsaved work is mirrored to localStorage.
 *
 * Saving publishes immediately (MVP) via PUT /api/doc-content/:slug; Revert
 * deletes the override so the page falls back to its original TSX. Both refresh
 * the public overrides SWR cache so the reader updates without a reload.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useSWRConfig } from 'swr';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import { DocMarkdown } from './DocMarkdown';
import { buildSeedMarkdown } from './docToMarkdown';
import { saveDocOverride, revertDocOverride } from './docEditApi';
import { useDocOverrides, type DocOverrideEntry } from './useDocOverrides';
import { META_BY_SLUG } from './registry';
import { DEMO_NAMES } from './shortcodes';

const draftKey = (slug: string) => `baton-doc-draft-${slug}`;

export function DocEditor({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { getToken } = useAuth();
  const { mutate } = useSWRConfig();
  const { data } = useDocOverrides();
  const existing = data?.overrides?.[slug];
  const hasOverride = !!existing;

  const [md, setMd] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'revert'>(null);
  const [error, setError] = useState<string | null>(null);

  const title = META_BY_SLUG[slug]?.title ?? slug;

  // Seed: localStorage draft → existing override → TSX-converted Markdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = localStorage.getItem(draftKey(slug));
      if (draft != null) { if (!cancelled) setMd(draft); return; }
      if (existing) { if (!cancelled) setMd(existing.contentMarkdown); return; }
      const seed = await buildSeedMarkdown(slug);
      if (!cancelled) setMd(seed);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Mirror edits to localStorage so a refresh doesn't lose work.
  useEffect(() => {
    if (md != null) localStorage.setItem(draftKey(slug), md);
  }, [md, slug]);

  // Esc closes the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleSave() {
    if (md == null) return;
    setBusy('save'); setError(null);
    try {
      const { version } = await saveDocOverride(slug, md, getToken);
      localStorage.removeItem(draftKey(slug));
      // Optimistically seed the cache with the saved content, then revalidate —
      // so the page reflects the edit immediately, with no stale-cache window.
      await mutate(
        '/api/public/doc-content',
        (cur: { overrides: Record<string, DocOverrideEntry> } | undefined) => ({
          overrides: {
            ...(cur?.overrides ?? {}),
            [slug]: { contentMarkdown: md, version, updatedAt: new Date().toISOString() },
          },
        }),
        { revalidate: true },
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleRevert() {
    setBusy('revert'); setError(null);
    try {
      await revertDocOverride(slug, getToken);
      localStorage.removeItem(draftKey(slug));
      // Drop the override from the cache immediately, then revalidate.
      await mutate(
        '/api/public/doc-content',
        (cur: { overrides: Record<string, DocOverrideEntry> } | undefined) => {
          const next = { ...(cur?.overrides ?? {}) };
          delete next[slug];
          return { overrides: next };
        },
        { revalidate: true },
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revert failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bd-editor" role="dialog" aria-modal="true" aria-label={`Edit ${title}`}>
      <header className="bd-editor__bar">
        <div className="bd-editor__title">
          Editing <strong>{title}</strong>
          <span className="bd-editor__path">/docs/{slug}</span>
        </div>
        <div className="bd-editor__actions">
          {error && <span className="bd-editor__error">{error}</span>}
          {hasOverride && (
            <button className="bd-editor__btn ghost" onClick={handleRevert} disabled={busy !== null}>
              {busy === 'revert' ? <Loader2 className="spin" /> : <RotateCcw />} Revert to original
            </button>
          )}
          <button className="bd-editor__btn ghost" onClick={onClose} disabled={busy !== null}>Cancel</button>
          <button className="bd-editor__btn primary" onClick={handleSave} disabled={busy !== null || md == null}>
            {busy === 'save' ? <Loader2 className="spin" /> : <Save />} Save &amp; publish
          </button>
        </div>
      </header>

      <div className="bd-editor__body">
        <div className="bd-editor__pane">
          <div className="bd-editor__panehead">
            Markdown
            <span className="bd-editor__hint">
              Shortcodes: <code>::demo[name]</code> · <code>:::note … :::</code> · <code>![alt](url "caption")</code>
            </span>
          </div>
          {md == null ? (
            <div className="bd-editor__loading"><Loader2 className="spin" /> Preparing content…</div>
          ) : (
            <textarea
              className="bd-editor__textarea"
              value={md}
              onChange={(e) => setMd(e.target.value)}
              spellCheck={false}
            />
          )}
          <div className="bd-editor__demos">
            Demos: {DEMO_NAMES.map((n) => <code key={n}>{n}</code>)}
          </div>
        </div>
        <div className="bd-editor__pane">
          <div className="bd-editor__panehead">Preview</div>
          <div className="bd-editor__preview">
            <article className="docs-prose">
              {md != null && <DocMarkdown source={md} />}
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
