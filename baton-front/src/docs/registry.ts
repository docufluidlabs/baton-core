/**
 * Baton docs — navigation model.
 * Single source of truth for the docs sidebar, section overview pages, search,
 * breadcrumbs, the home "documentation map", and the prev/next pager.
 * `welcome` is the landing page (route: /docs).
 */
export interface DocPageMeta {
  slug: string;
  title: string;
  /** One-line summary shown in section lists and on the home page. */
  description: string;
  keywords?: string;
}

export interface DocGroup {
  /** URL slug for the section overview page (/docs/section/:slug). */
  slug: string;
  title: string;
  /** Short intro shown on the section overview page and the home map. */
  intro: string;
  items: DocPageMeta[];
}

export const GROUPS: DocGroup[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    intro: 'New to Baton? Start here to understand what it does and ship your first automation.',
    items: [
      { slug: 'welcome', title: 'Welcome to Baton', description: 'What Baton is and how this guide is organized.', keywords: 'overview what is intro home start docusign maestro' },
      { slug: 'how-it-works', title: 'How Baton works', description: 'The end-to-end lifecycle of an event, from webhook to workflow.', keywords: 'lifecycle pipeline webhook verify route trigger flow' },
      { slug: 'concepts', title: 'Core concepts', description: 'The key terms: connections, automations, workflows, actions, instances.', keywords: 'terms connection automation workflow action instance object id source platform' },
      { slug: 'quick-start', title: 'Quick start', description: 'Build and test your first automation, step by step.', keywords: 'first automation tutorial setup steps walkthrough' },
    ],
  },
  {
    slug: 'connect',
    title: 'Connect your tools',
    intro: 'Connect Docusign and the platforms that send events into Baton.',
    items: [
      { slug: 'connect-docusign', title: 'Connect Docusign', description: 'The one connection Baton needs before anything else.', keywords: 'oauth maestro account login authorize sync token' },
      { slug: 'connections', title: 'Source platforms', description: 'Add a source platform and start receiving its webhooks.', keywords: 'add platform hubspot crm webhook secret connections catalog' },
      { slug: 'salesforce', title: 'Salesforce setup', description: 'Send Salesforce events to Baton with an outbound webhook you build in your org.', keywords: 'salesforce apex flow outbound message remote site hmac webhook manual' },
      { slug: 'custom-webhook', title: 'Custom POST webhooks', description: 'Send events from any system that is not in the catalog.', keywords: 'custom endpoint generic api key json bespoke' },
      { slug: 'setup', title: 'Setup guides', description: 'Step-by-step webhook setup for each supported platform.', keywords: 'setup guide bamboohr hubspot zoho install configure steps per platform' },
    ],
  },
  {
    slug: 'automations',
    title: 'Build & run automations',
    intro: 'Create the rules that turn platform events into Maestro workflow launches.',
    items: [
      { slug: 'flow-builder', title: 'Flow Builder', description: 'The visual canvas where you create and watch automations.', keywords: 'automation canvas create edit pause webhook url target workflow' },
      { slug: 'conditions', title: 'Conditions & mapping', description: 'Filter which webhooks count and map payload fields to Maestro.', keywords: 'rule conditions field mapping filter operators jsonpath payload' },
      { slug: 'workflows', title: 'Maestro Workflows', description: 'Sync Maestro workflows and launch any of them for testing.', keywords: 'workflow checker sync parameters launch test manual' },
    ],
  },
  {
    slug: 'monitor',
    title: 'Monitor & operate',
    intro: 'Keep your automations healthy: monitor runs, fix failures, and stay alerted.',
    items: [
      { slug: 'control-center', title: 'Resolution Center', description: 'Clear failed workflow runs: retry, cancel, report.', keywords: 'resolution control center failed overdue instances retry cancel report issue fix monitor filters tabs platform automation chips add days postpone in progress' },
      { slug: 'logs', title: 'Action logs & instances', description: 'Read action logs and Maestro run history; understand retries.', keywords: 'action log status verify route retry payload instances' },
      { slug: 'notifications', title: 'Notifications & alerts', description: "Choose how you're alerted, in-app and in Slack.", keywords: 'inbox slack preferences events bell alerts channel' },
    ],
  },
  {
    slug: 'account',
    title: 'Account',
    intro: 'Manage your organization and its members.',
    items: [
      { slug: 'settings', title: 'Settings', description: 'Organization details, members, and audit log.', keywords: 'organization timezone members audit email slack general' },
    ],
  },
  {
    slug: 'reference',
    title: 'Reference',
    intro: 'Look things up: verification, supported platforms, troubleshooting, and terms.',
    items: [
      { slug: 'verification', title: 'Verification methods', description: 'How Baton proves each webhook is genuine (HMAC, Basic Auth).', keywords: 'hmac basic auth signature secret security reject 401' },
      { slug: 'catalog', title: 'Supported platforms', description: 'Every platform Baton connects to, with its verification method.', keywords: 'integrations list connectors hubspot salesforce zendesk zoho' },
      { slug: 'troubleshooting', title: 'Troubleshooting & FAQ', description: 'Common problems and how to fix them fast.', keywords: 'help problems errors faq why not working fix support' },
      { slug: 'glossary', title: 'Glossary', description: 'Definitions for every term used in the docs.', keywords: 'definitions terms vocabulary meaning' },
    ],
  },
];

/** Backwards-compatible alias. */
export const DOC_NAV = GROUPS;

export interface FlatPage extends DocPageMeta {
  groupSlug: string;
  groupTitle: string;
}

export const DOC_ORDER: FlatPage[] = GROUPS.flatMap((g) =>
  g.items.map((it) => ({ ...it, groupSlug: g.slug, groupTitle: g.title })),
);

export const META_BY_SLUG: Record<string, { title: string; groupTitle: string; groupSlug: string }> =
  Object.fromEntries(
    GROUPS.flatMap((g) => g.items.map((it) => [it.slug, { title: it.title, groupTitle: g.title, groupSlug: g.slug }])),
  );

export const GROUP_BY_SLUG: Record<string, DocGroup> = Object.fromEntries(
  GROUPS.map((g) => [g.slug, g]),
);

export const DEFAULT_SLUG = 'welcome';
