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
      { slug: 'welcome', title: 'Welcome to Baton', description: 'What Baton is and how this guide is organized.', keywords: 'overview what is intro home start docusign workflow builder maestro' },
      { slug: 'how-it-works', title: 'How Baton works', description: 'The end-to-end lifecycle of an event, from webhook to workflow.', keywords: 'lifecycle pipeline webhook verify route trigger flow' },
      { slug: 'concepts', title: 'Core concepts', description: 'The key terms: connections, automations, workflows, relays, instances.', keywords: 'terms connection automation workflow relay action instance object id source platform bulk upload overdue control center resolution center custom endpoint maestro' },
      { slug: 'quick-start', title: 'Quick start', description: 'Build and test your first automation, step by step.', keywords: 'first automation tutorial setup steps walkthrough' },
    ],
  },
  {
    slug: 'connect',
    title: 'Connect your tools',
    intro: 'Connect Docusign and the platforms that send events into Baton.',
    items: [
      { slug: 'connect-docusign', title: 'Connect Docusign', description: 'The one connection Baton needs before anything else.', keywords: 'oauth workflow builder maestro account login authorize sync token connect hmac sandbox production developer redirect uri scopes disconnect reconnect tenant pkce' },
      { slug: 'connections', title: 'Source platforms', description: 'Add a source platform and start receiving its webhooks.', keywords: 'add platform hubspot crm webhook secret connections catalog token airtable smartsheet basic auth' },
      { slug: 'salesforce', title: 'Salesforce setup', description: 'Send Salesforce events to Baton with an outbound webhook you build in your org.', keywords: 'salesforce apex flow outbound message remote site hmac webhook manual' },
      { slug: 'custom-webhook', title: 'Custom POST webhooks', description: 'Send events from any system that is not in the catalog.', keywords: 'custom endpoint generic api key json bespoke postwebhook x-api-key rate limit record id 403 disabled endpoint' },
      { slug: 'setup', title: 'Setup guides', description: 'Step-by-step webhook setup for each supported platform.', keywords: 'setup guide bamboohr hubspot zoho install configure steps per platform' },
    ],
  },
  {
    slug: 'automations',
    title: 'Build & run automations',
    intro: 'Create the rules that turn platform events into Docusign workflow launches - or launch a workflow for every row of a file.',
    items: [
      { slug: 'flow-builder', title: 'Flow Builder', description: 'The visual canvas where you create and watch automations.', keywords: 'automation canvas create edit pause webhook url target workflow logs relay instances activity log bulk upload layout' },
      { slug: 'conditions', title: 'Conditions & field mapping', description: 'Filter which webhooks count and map payload fields to Workflow Builder.', keywords: 'rule conditions field mapping filter operators jsonpath payload maestro' },
      { slug: 'bulk-upload', title: 'Bulk Upload', description: 'Launch a workflow for every row of a CSV, XLSX or TSV file.', keywords: 'bulk upload batch csv xlsx tsv spreadsheet excel file rows run throttle release rate mapping columns preflight cap unfinished overdue pause resume concurrent maestro' },
      { slug: 'workflows', title: 'Workflow Checker', description: 'Sync Docusign workflows and launch any of them for testing.', keywords: 'workflow checker workflow builder maestro sync parameters launch test manual' },
    ],
  },
  {
    slug: 'monitor',
    title: 'Monitor & operate',
    intro: 'Keep your automations healthy: monitor runs, fix failures, and stay alerted.',
    items: [
      { slug: 'control-center', title: 'Control Center', description: 'Clear failed and overdue workflow runs: Try Again, Cancel, Add days.', keywords: 'control center resolution center failed overdue instances try again retry cancel add days postpone fix monitor filters tabs platform automation chips in progress' },
      { slug: 'logs', title: 'Relay logs & instances', description: 'Read relay logs and workflow run history; understand retries.', keywords: 'relay relays action log status verify route retry payload instances queued paused activity log maestro' },
      { slug: 'notifications', title: 'Notifications & alerts', description: "Choose how you're alerted, in-app and in Slack.", keywords: 'inbox slack preferences events bell alerts channel email severity routing mute bulk upload batch digest' },
    ],
  },
  {
    slug: 'account',
    title: 'Account',
    intro: 'Manage your organization and its members.',
    items: [
      { slug: 'settings', title: 'Settings', description: 'Organization details, members, and audit log.', keywords: 'organization timezone members audit email general roles invite permissions rbac owner admin member viewer' },
    ],
  },
  {
    slug: 'reference',
    title: 'Reference',
    intro: 'Look things up: verification, supported platforms, troubleshooting, and terms.',
    items: [
      { slug: 'verification', title: 'Webhook verification methods', description: 'How Baton proves each webhook is genuine - HMAC, shared token, Basic Auth, or URL secrecy.', keywords: 'hmac basic auth shared token airtable x-baton-token url secrecy monday signature secret security reject 401 replay timestamp rotate' },
      { slug: 'catalog', title: 'Supported platforms', description: 'Every platform Baton connects to, with its verification method.', keywords: 'integrations list connectors platforms category hubspot salesforce zendesk zoho smartsheet airtable monday bamboohr greenhouse power automate' },
      { slug: 'troubleshooting', title: 'Troubleshooting & FAQ', description: 'Common problems and how to fix them fast.', keywords: 'help problems errors faq why not working fix support' },
      { slug: 'glossary', title: 'Glossary', description: 'Definitions for every term used in the docs.', keywords: 'definitions terms vocabulary meaning relay overdue bulk upload control center resolution center custom post endpoint shared token instance' },
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
