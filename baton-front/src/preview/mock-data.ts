/**
 * Mock API Data — Preview Build
 *
 * Realistic sample data for all API endpoints so the preview
 * shows a populated, representative UI.
 */

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

// ─── Dashboard ───────────────────────────────────────────

const dashboard = {
  overview: {
    connections: { total: 4, healthy: 3, warning: 1, error: 0 },
    workflows: { total: 9, active: 8, totalLaunches: 142 },
    automations: { total: 8, active: 6, paused: 1, error: 1 },
    events24h: { total: 47, failed: 2 },
  },
  attentionItems: [
    {
      id: 'att-1',
      severity: 'warning' as const,
      title: 'HubSpot webhook errors detected',
      description: 'Check webhook configuration in HubSpot portal',
      platform: 'hubspot',
      timestamp: hoursAgo(1),
      actionUrl: '/connections',
    },
    {
      id: 'att-2',
      severity: 'critical' as const,
      title: 'Rule "Lead → Salesforce" has 60% failure rate',
      description: 'Auto-paused after 5 consecutive failures',
      platform: 'salesforce',
      timestamp: hoursAgo(3),
      actionUrl: '/events',
    },
  ],
  recentEvents: [
    { id: 'ev-1', orgId: 'org-1', eventType: 'deal.created', status: 'completed', eventSummary: 'New deal created: Acme Corp $50k', sourcePlatform: 'hubspot', triggeredAt: hoursAgo(0.5), completedAt: hoursAgo(0.5), durationMs: 1240 },
    { id: 'ev-2', orgId: 'org-1', eventType: 'lead.created', status: 'completed', eventSummary: 'New lead: John Smith from TechCo', sourcePlatform: 'salesforce', triggeredAt: hoursAgo(1), completedAt: hoursAgo(1), durationMs: 890 },
    { id: 'ev-3', orgId: 'org-1', eventType: 'deals.created', status: 'completed', eventSummary: 'Deal created in Zoho CRM', sourcePlatform: 'zohocrm', triggeredAt: hoursAgo(2), completedAt: hoursAgo(2), durationMs: 2100 },
    { id: 'ev-5', orgId: 'org-1', eventType: 'contact.created', status: 'completed', eventSummary: 'Contact synced from Salesforce', sourcePlatform: 'salesforce', triggeredAt: hoursAgo(5), completedAt: hoursAgo(5), durationMs: 1580 },
    { id: 'ev-6', orgId: 'org-1', eventType: 'contact.created', status: 'completed', eventSummary: 'New contact: Sarah Johnson', sourcePlatform: 'hubspot', triggeredAt: hoursAgo(8), completedAt: hoursAgo(8), durationMs: 430 },
  ],
  recentInstances: [
    { id: 'inst-1', workflowId: 'wf-1', maestroInstanceId: 'm-1', instanceName: 'Lead Routing — John Smith', status: 'running', currentStep: 'Assign to sales rep', lastCompletedStep: 2, lastCompletedStepName: 'Assign to sales rep', totalSteps: 5, startedAt: hoursAgo(1), expiresAt: hoursAgo(-23), startedByName: 'Jane Doe', startedByRole: 'Preparer', instanceUrl: 'https://maestro.docusign.com/instances/m-1' },
    { id: 'inst-2', workflowId: 'wf-2', maestroInstanceId: 'm-2', instanceName: 'Deal Qualification — Acme $50k', status: 'completed', lastCompletedStep: 3, lastCompletedStepName: 'Final Approval', totalSteps: 3, startedAt: hoursAgo(4), completedAt: hoursAgo(3), startedByName: 'Alex Johnson', startedByRole: 'Admin', instanceUrl: 'https://maestro.docusign.com/instances/m-2' },
    { id: 'inst-3', workflowId: 'wf-1', maestroInstanceId: 'm-3', instanceName: 'Lead Routing — Mike Chen', status: 'completed', lastCompletedStep: 5, lastCompletedStepName: 'Send Notification', totalSteps: 5, startedAt: daysAgo(1), completedAt: hoursAgo(20), startedByName: 'Jane Doe', startedByRole: 'Preparer', instanceUrl: 'https://maestro.docusign.com/instances/m-3' },
    { id: 'inst-4', workflowId: 'wf-3', maestroInstanceId: 'm-4', instanceName: 'Contact Enrichment — TechCo', status: 'failed', lastCompletedStep: 1, lastCompletedStepName: 'Enrich from API', totalSteps: 4, startedAt: hoursAgo(6), errorMessage: 'API rate limit reached — retry after 60s (Clearbit responded 429)', errorStep: 'Enrich from API', startedByName: 'Mike Rivera', startedByRole: 'Editor', instanceUrl: 'https://maestro.docusign.com/instances/m-4' },
    { id: 'inst-5', workflowId: 'wf-1', maestroInstanceId: 'm-5', instanceName: 'Lead Routing — Sara Lee', status: 'cancelled', lastCompletedStep: 1, lastCompletedStepName: 'Validate Lead', totalSteps: 5, startedAt: hoursAgo(8), completedAt: hoursAgo(7), startedByName: 'Alex Johnson', startedByRole: 'Admin', instanceUrl: 'https://maestro.docusign.com/instances/m-5' },
    { id: 'inst-7', workflowId: 'wf-1', maestroInstanceId: 'm-7', instanceName: 'Lead Routing — David Park', status: 'failed', lastCompletedStep: 2, lastCompletedStepName: 'Lookup CRM Record', totalSteps: 5, startedAt: hoursAgo(10), errorMessage: 'Salesforce API timeout — connection reset after 30s', errorStep: 'Lookup CRM Record', startedByName: 'Jane Doe', startedByRole: 'Preparer', instanceUrl: 'https://maestro.docusign.com/instances/m-7' },
    { id: 'inst-6', workflowId: 'wf-2', maestroInstanceId: 'm-6', instanceName: 'Deal Qualification — BigCorp $120k', status: 'running', currentStep: 'Signing Documents', lastCompletedStep: 1, lastCompletedStepName: 'Signing Documents', totalSteps: 3, startedAt: hoursAgo(2), expiresAt: hoursAgo(-4), startedByName: 'Sarah Kim', startedByRole: 'Preparer', instanceUrl: 'https://maestro.docusign.com/instances/m-6' },
  ],
  connections: [
    { id: 'conn-1', platform: 'salesforce', displayName: 'Salesforce Production', status: 'healthy', hasAccessToken: true, hasRefreshToken: true, createdAt: daysAgo(30) },
    { id: 'conn-2', platform: 'hubspot', displayName: 'HubSpot — Main Portal', status: 'healthy', hasAccessToken: true, hasRefreshToken: true, createdAt: daysAgo(25) },
    { id: 'conn-3', platform: 'zohocrm', displayName: 'Zoho CRM — Acme Corp', status: 'warning', hasAccessToken: true, hasRefreshToken: true, createdAt: daysAgo(20) },
  ],
};

// ─── Connections ─────────────────────────────────────────

// /api/connections returns the list of authenticated connections. In Baton only
// Docusign is a real connection (source platforms are webhook "shells" served by
// /api/platforms). A Docusign connection here also enables the gated nav items.
const connections = {
  connections: [
    {
      id: 'conn-docusign',
      platform: 'docusign',
      displayName: 'Docusign',
      status: 'healthy' as const,
      accountId: 'acct-preview-1',
      hasAccessToken: true,
      hasRefreshToken: true,
      createdAt: daysAgo(30),
      updatedAt: hoursAgo(2),
    },
  ],
};

const platforms = {
  platforms: [
    { platform: 'salesforce', displayName: 'Salesforce', eventTypes: [
      { eventType: 'lead.created', label: 'Lead Created', description: 'A new lead was created' },
      { eventType: 'opportunity.created', label: 'Opportunity Created', description: 'A new opportunity was created' },
      { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
    ]},
    { platform: 'hubspot', displayName: 'HubSpot', eventTypes: [
      { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'deal.created', label: 'Deal Created', description: 'A new deal was created' },
      { eventType: 'company.created', label: 'Company Created', description: 'A new company was created' },
    ]},
    { platform: 'zohocrm', displayName: 'Zoho CRM', eventTypes: [
      { eventType: 'deals.created', label: 'Deal Created', description: 'A new deal was created' },
      { eventType: 'contacts.created', label: 'Contact Created', description: 'A new contact was created' },
      { eventType: 'leads.created', label: 'Lead Created', description: 'A new lead was created' },
    ]},
  ],
};

// ─── Workflows ──────────────────────────────────────────

const workflows = {
  workflows: [
    { id: 'wf-1', name: 'Lead Routing & Assignment', description: 'Route new leads to the right sales rep based on territory', maestroWorkflowId: 'mwf-1', maestroStatus: 'active', connectionId: 'conn-1', launchCount: 42, lastLaunchedAt: hoursAgo(1), createdAt: daysAgo(45), triggerInputSchema: { type: 'object', properties: { leadId: { type: 'string' }, territory: { type: 'string' }, source: { type: 'string' } }, required: ['leadId'] } },
    { id: 'wf-2', name: 'Deal Qualification', description: 'Qualify deals and update CRM pipeline stage', maestroWorkflowId: 'mwf-2', maestroStatus: 'active', connectionId: 'conn-1', launchCount: 67, lastLaunchedAt: hoursAgo(4), createdAt: daysAgo(30), triggerInputSchema: { type: 'object', properties: { dealId: { type: 'string' }, dealAmount: { type: 'number' }, stage: { type: 'string' } }, required: ['dealId'] } },
    { id: 'wf-3', name: 'Contact Enrichment', description: 'Enrich contact data from external sources', maestroWorkflowId: 'mwf-3', maestroStatus: 'active', connectionId: 'conn-1', launchCount: 23, lastLaunchedAt: hoursAgo(6), createdAt: daysAgo(20), triggerInputSchema: { type: 'object', properties: { contactEmail: { type: 'string' }, companyName: { type: 'string' } }, required: ['contactEmail'] } },
    { id: 'wf-4', name: 'Cross-CRM Sync', description: 'Sync deals and contacts across CRM platforms', maestroWorkflowId: 'mwf-4', maestroStatus: 'active', launchCount: 8, lastLaunchedAt: daysAgo(2), createdAt: daysAgo(15), triggerInputSchema: { type: 'object', properties: { recordId: { type: 'string' }, recordType: { type: 'string' }, sourceCrm: { type: 'string' } }, required: ['recordId', 'recordType'] } },
    { id: 'wf-5', name: 'Win/Loss Analysis', description: 'Analyze closed deals and generate reports', maestroWorkflowId: 'mwf-5', maestroStatus: 'active', launchCount: 2, createdAt: daysAgo(5) },
    { id: 'wf-6', name: 'Account Onboarding', description: 'Automate new account setup across systems', maestroWorkflowId: 'mwf-6', maestroStatus: 'paused', launchCount: 0, createdAt: daysAgo(2) },
    { id: 'wf-7', name: 'Invoice Processing', description: 'Extract and validate invoice data from incoming documents', maestroWorkflowId: 'mwf-7', maestroStatus: 'active', launchCount: 0, createdAt: daysAgo(1), triggerInputSchema: { type: 'object', properties: { documentUrl: { type: 'string' }, vendorName: { type: 'string' }, amount: { type: 'number' } }, required: ['documentUrl'] } },
    { id: 'wf-8', name: 'Customer Health Score', description: 'Calculate and update customer health scores based on activity', maestroWorkflowId: 'mwf-8', maestroStatus: 'active', launchCount: 0, createdAt: daysAgo(1), triggerInputSchema: { type: 'object', properties: { customerId: { type: 'string' }, activityType: { type: 'string' } }, required: ['customerId'] } },
    { id: 'wf-9', name: 'Contract Review', description: 'Route contracts for review and approval', maestroWorkflowId: 'mwf-9', maestroStatus: 'active', launchCount: 0, createdAt: daysAgo(1), triggerInputSchema: { type: 'object', properties: { contractId: { type: 'string' }, contractType: { type: 'string' }, value: { type: 'number' } }, required: ['contractId', 'contractType'] } },
  ],
};

// ─── Rules ──────────────────────────────────────────────

const rules = {
  rules: [
    { id: 'r-1', name: 'Auto-route new leads', orgId: 'org-1', appSlug: 'salesforce', sourcePlatform: 'salesforce', eventType: 'lead.created', eventLabel: 'Lead Created', targetWorkflowId: 'wf-1', actionConfig: {}, status: 'active' as const, timesTriggered: 42, failureCount: 1, successRate: 97.6, lastTriggeredAt: hoursAgo(1), createdAt: daysAgo(40), webhookUrl: 'https://api.iambaton.com/api/webhooks/rule/a1b2c3d4e5f6' },
    { id: 'r-2', name: 'Qualify HubSpot deals', orgId: 'org-1', appSlug: 'hubspot', sourcePlatform: 'hubspot', eventType: 'deal.created', eventLabel: 'Deal Created', targetWorkflowId: 'wf-2', actionConfig: {}, status: 'active' as const, timesTriggered: 67, failureCount: 3, successRate: 95.5, lastTriggeredAt: hoursAgo(2), createdAt: daysAgo(30), webhookUrl: 'https://api.iambaton.com/api/webhooks/rule/b2c3d4e5f6g7' },
    { id: 'r-3', name: 'Enrich new contacts', orgId: 'org-1', appSlug: 'hubspot', sourcePlatform: 'hubspot', eventType: 'contact.created', eventLabel: 'Contact Created', targetWorkflowId: 'wf-3', actionConfig: {}, status: 'active' as const, timesTriggered: 23, failureCount: 2, successRate: 91.3, lastTriggeredAt: hoursAgo(5), createdAt: daysAgo(20), webhookUrl: 'https://api.iambaton.com/api/webhooks/rule/c3d4e5f6g7h8' },
  ],
};


// ─── Bulk Upload ──────────────────────────────────────────────

const batchProcessors = {
  processors: [
    {
      id: 'bp-1', orgId: 'org-1', name: 'Q3 renewal notices',
      targetWorkflowId: 'wf-1', status: 'active' as const,
      throttleReleaseCount: 25, throttleIntervalMinutes: 15,
      stopAfterConsecutiveFailures: 5, maxUnfinishedInstances: 100,
      expectedDurationDays: 7, createdAt: daysAgo(6), createdBy: 'u-1',
      lastRun: {
        id: 'br-1', runNumber: 3, fileName: 'renewals-q3.xlsx', status: 'completed',
        totalRows: 248, selectedRows: 248,
        counts: { queued: 0, running: 0, completed: 246, failed: 2, cancelled: 0, skipped: 0 },
        startedAt: hoursAgo(26), completedAt: hoursAgo(22), createdByName: 'Alex Rivera',
      },
    },
    {
      id: 'bp-2', orgId: 'org-1', name: 'New-hire paperwork',
      targetWorkflowId: 'wf-3', status: 'active' as const,
      throttleReleaseCount: 10, throttleIntervalMinutes: 30,
      stopAfterConsecutiveFailures: 3, maxUnfinishedInstances: null,
      expectedDurationDays: 3, createdAt: daysAgo(2), createdBy: 'u-1',
      lastRun: {
        id: 'br-2', runNumber: 1, fileName: 'august-starters.csv', status: 'running',
        totalRows: 64, selectedRows: 60,
        counts: { queued: 22, running: 3, completed: 35, failed: 0, cancelled: 0, skipped: 4 },
        startedAt: hoursAgo(1), nextReleaseAt: new Date(Date.now() + 9 * 60_000).toISOString(),
        createdByName: 'Alex Rivera',
      },
    },
  ],
};


// Per-workflow instance rollup. Mirrors the automation totals so the canvas
// reads consistently: an automation that reports 41 completed is pointed at a
// workflow that also shows 41.
const instanceCounts = {
  counts: {
    'wf-1': { completed: 41, failed: 1, cancelled: 0, running: 0 },
    'wf-2': { completed: 64, failed: 3, cancelled: 0, running: 0 },
    'wf-3': { completed: 21, failed: 2, cancelled: 0, running: 0 },
  },
};


// ─── Bulk Upload wizard (demo capture) ────────────────────────
// Enough of the upload → map → run path to drive the marketing capture.
// The run advances on wall-clock time so rows visibly complete while
// recording, instead of needing a real dispatcher.

const DEMO_COLUMNS = ['leadId', 'territory', 'source', 'company', 'ownerEmail'];

const DEMO_ROWS = [
  { leadId: '00Q5f000004Ta1x', territory: 'EMEA - North',  source: 'Renewal', company: 'Northwind Trading',  ownerEmail: 'r.olsen@northwind.example' },
  { leadId: '00Q5f000004Tb2y', territory: 'AMER - West',   source: 'Renewal', company: 'Cascade Logistics',  ownerEmail: 'm.reyes@cascade.example' },
  { leadId: '00Q5f000004Tc3z', territory: 'EMEA - South',  source: 'Renewal', company: 'Adriatic Foods',     ownerEmail: 'l.bruno@adriatic.example' },
  { leadId: '00Q5f000004Td4a', territory: 'APAC - East',   source: 'Renewal', company: 'Kiyomi Robotics',    ownerEmail: 'h.tanaka@kiyomi.example' },
  { leadId: '00Q5f000004Te5b', territory: 'AMER - East',   source: 'Renewal', company: 'Bayline Insurance',  ownerEmail: 'p.novak@bayline.example' },
];

const DEMO_TOTAL_ROWS = 248;
const DEMO_RUN_ID = 'br-demo';
let demoRunStartedAt: number | null = null;

/** Rows completed so far — one every 220ms once the run starts, capped. */
function demoCompleted(): number {
  if (!demoRunStartedAt) return 0;
  return Math.min(DEMO_TOTAL_ROWS, Math.floor((Date.now() - demoRunStartedAt) / 220));
}

function demoRunSummary() {
  const completed = demoCompleted();
  const running = demoRunStartedAt && completed < DEMO_TOTAL_ROWS ? 3 : 0;
  return {
    id: DEMO_RUN_ID, runNumber: 4, fileName: 'renewals-q3.xlsx',
    status: !demoRunStartedAt ? 'pending' : completed >= DEMO_TOTAL_ROWS ? 'completed' : 'running',
    totalRows: DEMO_TOTAL_ROWS, selectedRows: DEMO_TOTAL_ROWS,
    counts: {
      queued: Math.max(0, DEMO_TOTAL_ROWS - completed - running),
      running, completed, failed: 0, cancelled: 0, skipped: 0,
    },
    startedAt: demoRunStartedAt ? new Date(demoRunStartedAt).toISOString() : undefined,
    createdByName: 'Alex Rivera',
  };
}

/** A window of rows around the completion frontier, so the list visibly moves. */
function demoRows() {
  const completed = demoCompleted();
  const out = [];
  const start = Math.max(1, completed - 6);
  for (let n = start; n < start + 14 && n <= DEMO_TOTAL_ROWS; n++) {
    const d = DEMO_ROWS[(n - 1) % DEMO_ROWS.length];
    const status = n <= completed ? 'completed' : n <= completed + 3 && demoRunStartedAt ? 'running' : 'queued';
    out.push({
      rowNumber: n, seq: n, name: d.company, status, problems: [], data: d,
      payload: { leadId: d.leadId, territory: d.territory, source: d.source },
      ...(status !== 'queued' ? { workflowInstanceId: `wfi-${n}`, maestroInstanceId: `m-${n}` } : {}),
    });
  }
  return { rows: out };
}

// ─── Events ─────────────────────────────────────────────

const events = {
  events: dashboard.recentEvents,
  count: 47,
  hasMore: true,
  nextCursor: null,
};

// ─── Notifications ──────────────────────────────────────

const notifications = {
  notifications: [
    { id: 'n-1', title: 'Rule auto-paused', message: 'Rule "Sync Zoho deals" was auto-paused due to high failure rate (60%)', severity: 'warning', eventType: 'rule.auto_paused', createdAt: hoursAgo(3) },
    { id: 'n-2', title: 'Workflow failed', message: 'Contact Enrichment — TechCo failed at step "Lookup company"', severity: 'error', eventType: 'workflow.failed', createdAt: hoursAgo(6) },
    { id: 'n-3', title: 'Connection warning', message: 'Zoho CRM token needs refresh. Reconnect to avoid disruption.', severity: 'warning', eventType: 'connection.expiring', createdAt: hoursAgo(12) },
    { id: 'n-4', title: 'New workflow synced', message: 'Account Onboarding workflow synced from Docusign Maestro', severity: 'info', eventType: 'workflow.synced', readAt: hoursAgo(1), createdAt: daysAgo(2) },
  ],
  unreadCount: 3,
};

// ─── Settings / Billing ─────────────────────────────────

const billing = {
  billing: {
    plan: 'professional',
    currentUsage: { workflowLaunches: 142, successfulExecutions: 135, connections: 4 },
    planLimits: { workflowLaunches: 500, connections: 10 },
    billingCycleStart: daysAgo(15),
    stripeCustomerId: '***',
    hasStripe: true,
  },
};

const billingPlans = {
  plans: [
    { slug: 'starter', name: 'Starter', monthlyPrice: 5, priceId: null, limits: { executions: 50, connections: 3, adminSeats: 1 }, features: ['50 executions/mo', '3 connections', '1 admin seat'] },
    { slug: 'professional', name: 'Professional', monthlyPrice: 9, priceId: 'price_xxx_pro', limits: { executions: 500, connections: 10, adminSeats: 3 }, features: ['500 executions/mo', '10 connections', '3 admin seats', 'Advanced conditions', 'API access', 'Audit log'] },
    { slug: 'business', name: 'Business', monthlyPrice: 14, priceId: 'price_xxx_biz', limits: { executions: 5000, connections: 25, adminSeats: 10 }, features: ['5,000 executions/mo', '25 connections', '10 admin seats', 'Custom branding', 'Unlimited connections'] },
    { slug: 'enterprise', name: 'Enterprise', monthlyPrice: 399, priceId: 'price_xxx_ent', limits: { executions: -1, connections: -1, adminSeats: -1 }, features: ['Unlimited executions', 'Unlimited connections', 'Unlimited seats', 'Priority support', 'SSO / SAML'] },
  ],
};

const authMe = {
  user: { id: 'preview-user', email: 'alex@acme.com', role: 'owner' },
  organization: {
    id: 'org_preview',
    name: 'Acme Corp',
    plan: 'professional',
    features: ['advanced_conditions', 'api_access', 'audit_log'],
    executionsUsed: 142,
  },
};

// ─── Apps ───────────────────────────────────────────────

const apps = {
  apps: [
    { id: 'app-1', appSlug: 'salesforce', displayName: 'Salesforce', webhookKey: 'wh_xxx', webhookUrl: 'https://api.iambaton.com/api/webhooks/salesforce/org_preview', addedAt: daysAgo(30), status: 'active', icon: '☁️', category: 'CRM' },
    { id: 'app-2', appSlug: 'hubspot', displayName: 'HubSpot', webhookKey: 'wh_yyy', webhookUrl: 'https://api.iambaton.com/api/webhooks/hubspot/org_preview', addedAt: daysAgo(25), status: 'active', icon: '🔶', category: 'CRM' },
  ],
};

// Alias: useInstalledPlatforms() fetches /api/platforms → { platforms: InstalledPlatform[] }
const installedPlatforms = {
  platforms: apps.apps,
};

const appsCatalog = {
  catalog: [
    { slug: 'salesforce', displayName: 'Salesforce', icon: '☁️', category: 'CRM', description: 'CRM platform — leads, opportunities, contacts', webhookCapable: true },
    { slug: 'hubspot', displayName: 'HubSpot', icon: '🔶', category: 'CRM', description: 'CRM and marketing — contacts, deals, companies', webhookCapable: true },
    { slug: 'zohocrm', displayName: 'Zoho CRM', icon: '💼', category: 'CRM', description: 'Customer relationship management', webhookCapable: true },
  ],
};

// Alias: usePlatformTemplates() fetches /api/platforms/catalog → { templates: PlatformTemplate[] }
const platformTemplates = {
  templates: [
    {
      slug: 'salesforce', name: 'Salesforce', icon: '☁️', category: 'CRM',
      description: 'CRM platform — leads, opportunities, contacts', webhookCapable: true as const,
      secretKeyLabel: 'Webhook Secret', secretKeyHint: 'Found in Salesforce Setup → Outbound Messages',
      setupInstructions: [
        { step: 1, title: 'Go to Salesforce Setup', description: 'Navigate to Setup → Outbound Messages' },
        { step: 2, title: 'Create Outbound Message', description: 'Create a new outbound message pointing to your webhook URL' },
        { step: 3, title: 'Copy Secret', description: 'Copy the generated secret and paste it here' },
      ],
      supportedEvents: [
        { eventType: 'lead.created', label: 'Lead Created', description: 'A new lead was created' },
        { eventType: 'opportunity.created', label: 'Opportunity Created', description: 'A new opportunity was created' },
        { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
      ],
    },
    {
      slug: 'hubspot', name: 'HubSpot', icon: '🔶', category: 'CRM',
      description: 'CRM and marketing — contacts, deals, companies', webhookCapable: true as const,
      secretKeyLabel: 'Client Secret', secretKeyHint: 'Found in HubSpot App Settings → Auth',
      setupInstructions: [
        { step: 1, title: 'Go to HubSpot Developer', description: 'Navigate to your HubSpot app settings' },
        { step: 2, title: 'Configure Webhooks', description: 'Add your webhook URL under Webhooks section' },
        { step: 3, title: 'Copy Client Secret', description: 'Copy the client secret from the Auth tab' },
      ],
      supportedEvents: [
        { eventType: 'contact.created', label: 'Contact Created', description: 'A new contact was created' },
        { eventType: 'deal.created', label: 'Deal Created', description: 'A new deal was created' },
        { eventType: 'company.created', label: 'Company Created', description: 'A new company was created' },
      ],
    },
    {
      slug: 'zohocrm', name: 'Zoho CRM', icon: '💼', category: 'CRM',
      description: 'Customer relationship management', webhookCapable: true as const,
      secretKeyLabel: 'Webhook Secret Token', secretKeyHint: 'Generated in Zoho CRM → Settings → Webhooks',
      setupInstructions: [
        { step: 1, title: 'Open Zoho CRM Settings', description: 'Go to Settings → Developer Space → Webhooks' },
        { step: 2, title: 'Create Webhook', description: 'Add a new webhook with your endpoint URL' },
        { step: 3, title: 'Copy Secret Token', description: 'Copy the secret token shown after creation' },
      ],
      supportedEvents: [
        { eventType: 'deals.created', label: 'Deal Created', description: 'A new deal was created' },
        { eventType: 'contacts.created', label: 'Contact Created', description: 'A new contact was created' },
        { eventType: 'leads.created', label: 'Lead Created', description: 'A new lead was created' },
      ],
    },
  ],
};

// ─── Settings ──────────────────────────────────────────

const settingsOrg = {
  organization: {
    name: 'Acme Corp',
    timezone: 'America/New_York',
    notificationEmail: 'alerts@acme.com',
    slackWebhookUrl: '',
  },
};

const settingsMembers = {
  members: [
    { id: 'member-1', fullName: 'Alex Kovalenko', email: 'alex@acme.com', role: 'owner', createdAt: daysAgo(90) },
    { id: 'member-2', fullName: 'Sarah Chen', email: 'sarah@acme.com', role: 'admin', createdAt: daysAgo(60) },
    { id: 'member-3', fullName: 'Mike Johnson', email: 'mike@acme.com', role: 'member', createdAt: daysAgo(30) },
    { id: 'member-4', fullName: 'Emily Davis', email: 'emily@acme.com', role: 'viewer', createdAt: daysAgo(15) },
  ],
};

const settingsAudit = {
  auditLog: [
    { id: 'audit-1', action: 'automation.created', entityType: 'automation', userId: 'member-1', createdAt: hoursAgo(2), metadata: { name: 'Auto-route new leads' } },
    { id: 'audit-2', action: 'platform.installed', entityType: 'platform', userId: 'member-1', createdAt: hoursAgo(6), metadata: { appSlug: 'hubspot' } },
    { id: 'audit-3', action: 'automation.paused', entityType: 'automation', userId: 'member-2', createdAt: daysAgo(1), metadata: { name: 'Zoho lead → routing' } },
    { id: 'audit-4', action: 'member.invited', entityType: 'member', userId: 'member-1', createdAt: daysAgo(2), metadata: { email: 'emily@acme.com' } },
    { id: 'audit-5', action: 'connection.created', entityType: 'connection', userId: 'member-1', createdAt: daysAgo(5), metadata: { platform: 'docusign' } },
  ],
};

// ─── Webhook Endpoints ─────────────────────────────────

const webhookEndpoints = {
  endpoints: [
    { id: 'whe-1', name: 'Lead Intake', platform: 'salesforce', workflowId: 'wf-1', payloadFieldPath: '$.data', rateLimitPerMinute: 60, enabled: true, requestCount: 142, lastRequestAt: hoursAgo(1), webhookUrl: 'https://api.iambaton.com/api/webhooks/endpoint/whe-1', hasApiKey: true, createdAt: daysAgo(30), updatedAt: daysAgo(2) },
    { id: 'whe-2', name: 'Deal Sync', platform: 'hubspot', workflowId: 'wf-2', payloadFieldPath: '$.deal', rateLimitPerMinute: 30, enabled: true, requestCount: 67, lastRequestAt: hoursAgo(4), webhookUrl: 'https://api.iambaton.com/api/webhooks/endpoint/whe-2', hasApiKey: true, createdAt: daysAgo(25), updatedAt: daysAgo(5) },
  ],
};

const eventStats = {
  stats: {
    total24h: 47,
    failureRate: 4.3,
    byStatus: { completed: 1180, failed: 67, running: 3, pending: 0 },
    avgDurationMs: 1340,
  },
};

const instances = {
  instances: dashboard.recentInstances,
};

// ─── Route Map ──────────────────────────────────────────

const MOCK_ROUTES: Record<string, unknown> = {
  '/api/dashboard': dashboard,
  '/api/connections': connections,
  '/api/connections/platforms': platforms,
  '/api/workflows': workflows,
  '/api/rules': rules,
  '/api/automations': { automations: rules.rules },
  '/api/events': events,
  '/api/events/stats': eventStats,
  '/api/notifications': notifications,
  '/api/settings/billing': billing,
  '/api/settings/billing/plans': billingPlans,
  '/api/auth/me': authMe,
  '/api/instances/counts': instanceCounts,
  '/api/batch-processors': batchProcessors, // live run is patched in by the fetch shim
  '/api/apps': apps,
  '/api/apps/catalog': appsCatalog,
  '/api/platforms': installedPlatforms,
  '/api/platforms/catalog': platformTemplates,
  '/api/instances': instances,
  '/api/settings/org': settingsOrg,
  '/api/settings/members': settingsMembers,
  '/api/settings/audit': settingsAudit,
  '/api/webhook-endpoints': webhookEndpoints,
};

/**
 * Intercept fetch and return mock data for API routes.
 * Non-API requests (CSS, images, etc.) pass through normally.
 */
export function installMockFetch() {
  const originalFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Only intercept /api/* requests
    if (url.startsWith('/api')) {
      const path = url.split('?')[0]; // strip query params

      // Check exact match first
      if (MOCK_ROUTES[path]) {
        await delay(150 + Math.random() * 300); // Simulate network latency
        return new Response(JSON.stringify(MOCK_ROUTES[path]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Handle dynamic routes

      // Processor list — swap in the live demo run once one has started.
      if (path === '/api/batch-processors' && demoRunStartedAt) {
        const [first, ...rest] = batchProcessors.processors;
        return new Response(JSON.stringify({
          processors: [{ ...first, lastRun: demoRunSummary() }, ...rest],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }


      // ── Bulk Upload wizard (demo capture) ──────────────────
      if (path.match(/^\/api\/batch-processors\/[\w-]+\/uploads$/)) {
        await delay(700); // let the uploading spinner register on camera
        return new Response(JSON.stringify({
          runId: DEMO_RUN_ID,
          columns: DEMO_COLUMNS,
          totalRows: DEMO_TOTAL_ROWS,
          blankRowsSkipped: 2,
          sheetNames: ['Renewals Q3'],
          sheetName: 'Renewals Q3',
          preview: DEMO_ROWS.slice(0, 3),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (path.match(/^\/api\/batch-processors\/[\w-]+\/runs\/[\w-]+\/preflight$/)) {
        await delay(400);
        return new Response(JSON.stringify({
          readyRows: DEMO_TOTAL_ROWS, problemRows: [], unmappedRequired: [],
          estimatedMinutes: 150, planUsage: { used: null, included: null },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (path.match(/^\/api\/batch-processors\/[\w-]+\/runs\/[\w-]+\/start$/)) {
        demoRunStartedAt = Date.now();
        await delay(250);
        return new Response(JSON.stringify({ run: demoRunSummary() }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path.match(/^\/api\/batch-processors\/[\w-]+\/runs\/[\w-]+\/rows$/)) {
        return new Response(JSON.stringify(demoRows()), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path.match(/^\/api\/batch-processors\/[\w-]+\/runs$/)) {
        const runs = demoRunStartedAt
          ? [demoRunSummary(), ...batchProcessors.processors[0].lastRun ? [batchProcessors.processors[0].lastRun] : []]
          : [batchProcessors.processors[0].lastRun];
        return new Response(JSON.stringify({ runs }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path.match(/^\/api\/workflows\/[\w-]+\/instances/)) {
        await delay(200);
        return new Response(JSON.stringify({ instances: dashboard.recentInstances.slice(0, 2) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path.match(/^\/api\/automations\/[\w-]+\/history/)) {
        await delay(200);
        return new Response(JSON.stringify({ history: dashboard.recentEvents.slice(0, 3) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path.match(/^\/api\/automations\/event-types\/\w+/)) {
        const platform = path.split('/').pop()!;
        const plat = platforms.platforms.find((p) => p.platform === platform);
        await delay(200);
        return new Response(JSON.stringify({ eventTypes: plat?.eventTypes || [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path.match(/^\/api\/connections\/[\w-]+\/accounts/)) {
        await delay(200);
        return new Response(JSON.stringify({ accounts: [{ id: 'acct-1', name: 'Main Account', isDefault: true }], selectedAccountId: 'acct-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (path.match(/^\/api\/rules\/[\w-]+\/history/)) {
        await delay(200);
        return new Response(JSON.stringify({ history: dashboard.recentEvents.slice(0, 3) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Automation preflight — return pre-generated webhook URL
      if (path === '/api/automations/preflight' && init?.method === 'POST') {
        const key = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
        await delay(200);
        return new Response(JSON.stringify({ webhookKey: key, webhookUrl: `https://app.baton.so/api/webhooks/rule/${key}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Automation queue — list queued webhooks for a paused rule
      const queueMatch = path.match(/^\/api\/automations\/([^/]+)\/queue$/);
      if (queueMatch && (!init?.method || init.method === 'GET')) {
        await delay(200);
        const items = [
          { id: 'q-1', ruleId: queueMatch[1], platform: 'zohocrm', eventType: 'deal.updated', eventSummary: 'Deal "Acme Corp" updated', queuedAt: new Date(Date.now() - 120_000).toISOString(), status: 'queued' },
          { id: 'q-2', ruleId: queueMatch[1], platform: 'zohocrm', eventType: 'deal.won', eventSummary: 'Deal "Widget Co" marked won', queuedAt: new Date(Date.now() - 45_000).toISOString(), status: 'queued' },
        ];
        return new Response(JSON.stringify({ items, count: items.length }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // POST endpoints — return success
      if (init?.method && init.method !== 'GET') {
        await delay(300);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Unknown API route — 404
      return new Response(JSON.stringify({ error: 'Not found (preview mode)' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Non-API requests pass through
    return originalFetch(input, init);
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
