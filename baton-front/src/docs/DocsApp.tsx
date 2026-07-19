/**
 * Baton docs — entry point mounted at `/docs/*` (public route).
 * Resolves the active slug to a page component, a section overview, or a
 * data-driven platform setup guide, and renders it inside the DocsLayout
 * chrome. Unknown slugs redirect to home.
 */
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { DocsLayout } from './DocsLayout';
import { SectionIndex } from './SectionIndex';
import { SetupOverview, SetupGuide, SetupNotFound } from './SetupGuides';
import { usePublicCatalog } from './useCatalog';
import { useDocOverrides } from './useDocOverrides';
import { DocMarkdown } from './DocMarkdown';
import { DOC_COMPONENTS } from './pages';
import { DEFAULT_SLUG, GROUP_BY_SLUG } from './registry';
import './docs.css';

function DocPage({ slug }: { slug: string }) {
  const Component = DOC_COMPONENTS[slug];
  const { data } = useDocOverrides();
  if (!Component) return <Navigate to="/docs" replace />;
  // A published FluidLabs edit replaces the hardcoded page. While overrides are
  // still loading we show the TSX page (most pages have none), then swap if one
  // exists for this slug.
  const override = data?.overrides?.[slug];
  return (
    <DocsLayout slug={slug} kind="page" contentKey={override ? `md${override.version}` : 'tsx'}>
      {override ? <DocMarkdown source={override.contentMarkdown} /> : <Component />}
    </DocsLayout>
  );
}

function DocPageBySlug() {
  const { slug = DEFAULT_SLUG } = useParams();
  return <DocPage slug={slug} />;
}

function SectionPage() {
  const { groupSlug = '' } = useParams();
  const group = GROUP_BY_SLUG[groupSlug];
  if (!group) return <Navigate to="/docs" replace />;
  return (
    <DocsLayout slug={groupSlug} kind="section">
      <SectionIndex group={group} />
    </DocsLayout>
  );
}

function SetupOverviewPage() {
  return (
    <DocsLayout slug="setup" kind="page">
      <SetupOverview />
    </DocsLayout>
  );
}

function SetupGuidePage() {
  const { slug = '' } = useParams();
  const { data, isLoading } = usePublicCatalog();
  // Salesforce uses a dedicated managed-package page.
  if (slug === 'salesforce') return <Navigate to="/docs/salesforce" replace />;
  const template = data?.templates.find((t) => t.slug === slug);
  return (
    <DocsLayout slug="setup" kind="page" subTitle={template?.name ?? slug}>
      {isLoading ? (
        <p>Loading setup guide…</p>
      ) : template ? (
        <SetupGuide template={template} />
      ) : (
        <SetupNotFound slug={slug} />
      )}
    </DocsLayout>
  );
}

export default function DocsApp() {
  return (
    <Routes>
      <Route index element={<DocPage slug={DEFAULT_SLUG} />} />
      <Route path="section/:groupSlug" element={<SectionPage />} />
      <Route path="setup" element={<SetupOverviewPage />} />
      <Route path="setup/:slug" element={<SetupGuidePage />} />
      <Route path=":slug" element={<DocPageBySlug />} />
      <Route path="*" element={<Navigate to="/docs" replace />} />
    </Routes>
  );
}
