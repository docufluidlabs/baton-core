/**
 * Baton — Shared Types
 * All entity types, enums, and interfaces used across backend and frontend
 */

// ─── Enums ───────────────────────────────────────────────────

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer' | 'superuser';
export type OrgPlan = 'free_demo' | 'starter' | 'growth' | 'enterprise';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused_overcap';
// Registered connectors: docusign (destination) + salesforce, hubspot, zohocrm,
// zendesk, bamboohr, powerautomate (inbound). greenhouse/mondaycom/slack are
// catalog/webhook-only integrations without a connector class.
// Legacy platforms kept for backward compat with existing connectors/routes
export type Platform = 'salesforce' | 'hubspot' | 'zohocrm' | 'bamboohr' | 'docusign' | 'zendesk' | 'slack' | 'greenhouse' | 'mondaycom' | 'powerautomate';
export type AppSlug = 'salesforce' | 'hubspot' | 'zohocrm' | 'bamboohr' | 'zendesk' | 'slack' | 'greenhouse' | 'mondaycom' | 'powerautomate';
export type ConnectionStatus = 'pending' | 'healthy' | 'warning' | 'error' | 'disconnected';
export type MaestroStatus = 'draft' | 'active' | 'paused';
export type TriggerType = 'http' | 'link' | 'api_call' | 'form';
export type InstanceStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RuleStatus = 'active' | 'paused' | 'error' | 'disabled';
export type PipelineStatus = 'pending' | 'running' | 'retrying' | 'completed' | 'failed' | 'skipped';
export type EventCategory = 'inbound' | 'rule_match' | 'workflow' | 'envelope';
export type ErrorCategory = 'auth' | 'validation' | 'upstream' | 'internal' | 'rate_limit' | 'quota';
export type RetryStrategy = 'linear' | 'exponential';
export type NotificationChannel = 'email' | 'slack' | 'in_app';
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';
export type EnvelopeStatus = 'sent' | 'delivered' | 'signed' | 'completed' | 'declined';

export type NotificationEventType =
  | 'workflow_launched'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'workflow_synced'
  | 'retry_exhausted'
  | 'webhook_failed'
  | 'connection_degraded'
  | 'connection_created'
  | 'connection_disconnected'
  | 'execution_quota_exceeded'
  | 'execution_quota_warning'
  | 'billing_overage_started'
  | 'billing_hard_cap'
  | 'billing_drift'
  | 'billing_trial_ending'
  | 'billing_past_due'
  | 'rule_error';

// ─── Entities ────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  /** Trial expiry for `free_demo` plan; 14 days after org creation. */
  trialEndsAt?: string;
  /** Mirror of Stripe subscription.status, mapped to our enum. */
  subscriptionStatus?: SubscriptionStatus;
  /** Included relays per cycle, derived from plan. Stored for fast read. */
  includedRelays?: number;
  /** True when the plan has a metered overage tier (starter, growth). */
  overageEnabled?: boolean;
  /** Cents per relay above includedRelays. */
  overageRateCents?: number;
  /** Optional opt-in hard cap. null = off. When exceeded, relays are paused. */
  hardCap?: number | null;
  /** Timestamp of last paused_overcap transition (for diagnostics). */
  hardCapPausedAt?: string | null;
  /** True for enterprise; skip meter emission for these orgs. */
  exemptFromMeter?: boolean;
  /** Once-per-cycle dedupe flag for the "overage started" notification. */
  overageStartedShownAt?: string | null;
  /** Once-per-cycle dedupe flag for the "hard cap reached" notification. */
  hardCapShownAt?: string | null;
  executionsUsed?: number;
  successfulExecutions?: number;
  billingCycleStart?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
  role: UserRole;
  /** bcrypt hash — absent on pending-invite rows until the invite is accepted. */
  passwordHash?: string;
  /** Pending invite token (crypto-random hex). Cleared on accept. */
  inviteToken?: string;
  /** ISO expiry for inviteToken (72h). Cleared on accept. */
  inviteExpiresAt?: string;
  invitedBy?: string;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformConnection {
  id: string;
  orgId: string;
  platform: Platform;
  displayName: string;
  accountId?: string;
  status: ConnectionStatus;
  accessTokenEnc?: string;
  refreshTokenEnc?: string;
  tokenExpiresAt?: string;
  scopes?: string[];
  metadata?: Record<string, any>;
  webhookId?: string;
  webhookSecret?: string;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

/** DB-mapped type. Frontend refers to this as `InstalledPlatform`. */
export interface OrgApp {
  id: string;
  orgId: string;
  appSlug: AppSlug;
  webhookKey: string;          // 64-char hex — acts as capability token
  /**
   * Legacy single-tenant secret. v0.1–v0.3.0-1 wrote here. Kept for backward
   * compat: rule webhook handler falls back to this when no per-SF-org secret
   * exists in `sfRegistrations`. New v0.3.0-2+ writes go to the map.
   */
  secretKeyEnc?: string;       // AES-256-GCM encrypted platform secret key (set later via Flow Builder)
  /**
   * Per-(SF-org, webhook) HMAC secrets.
   *
   * Current keying (composite): `<sfOrgId>#<webhookKey>` — one independent
   * secret per automation rule per SF org, matching the Apex package's
   * per-webhookKey secret cache. See lib/sf-registration-key.ts.
   *
   * Legacy keying (pre-composite): bare `<sfOrgId>` — one secret shared by
   * ALL rules of the app for that SF org. Still read as a fallback by
   * rule.ts; new registrations always write composite keys.
   *
   * Populated by POST /api/salesforce/webhook-registrations (v0.3.0-2+).
   */
  sfRegistrations?: Record<string, {
    secretKeyEnc: string;
    secretVersion: number;
    registeredAt: string;
    packageVersion?: string;
  }>;
  displayName: string;
  status: 'active' | 'inactive';
  addedAt: string;
  addedBy?: string;
  lastWebhookAt?: string;      // updated on each incoming webhook
  webhookCount?: number;       // total received
}

export interface WebhookEndpoint {
  id: string;
  orgId: string;
  name: string;
  /** Platform/workspace this endpoint is associated with */
  platform: string;
  /** Maestro workflow to launch when webhook is received */
  workflowId: string;
  /** Dot-notation path to the record ID field in the payload (e.g. "object_id", "data.id") */
  payloadFieldPath: string;
  /** Optional API key for authentication — if set, requests must include it in X-API-Key header */
  apiKey?: string;
  /** Number of requests allowed per minute for this endpoint */
  rateLimitPerMinute: number;
  /** Whether the endpoint is active */
  enabled: boolean;
  /** Total number of requests received */
  requestCount: number;
  lastRequestAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface Workflow {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  maestroWorkflowId?: string;
  maestroStatus: MaestroStatus;
  triggerType: TriggerType;
  triggerInputSchema?: Record<string, any>;
  stepCount: number;
  stepsConfig?: Record<string, any>;
  platform: Platform;
  connectionId?: string;
  objectTypes?: string[];
  tags?: string[];
  launchCount: number;
  lastLaunchedAt?: string;
  createdAt: string;
  updatedAt: string;
  maestroUpdatedAt?: string;
  createdBy?: string;
}

export interface WorkflowInstance {
  id: string;
  orgId: string;
  workflowId: string;
  maestroInstanceId?: string;
  instanceName: string;
  status: InstanceStatus;
  currentStep?: string;
  lastCompletedStep?: number;
  lastCompletedStepName?: string;
  totalSteps?: number;
  stepProgress?: number[];
  triggerRuleId?: string;
  triggerRuleName?: string;
  triggerActionNumber?: number;
  triggerEventId?: string;
  sourcePlatform?: string;
  inputData?: Record<string, any>;
  outputData?: Record<string, any>;
  envelopeId?: string;
  envelopeStatus?: EnvelopeStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  errorStep?: string;
  retryCount: number;
  retrySequenceId?: string;
  retryMaxAttempts?: number;
  nextRetryAt?: string;
  manuallyRetriedAt?: string;
  manuallyCancelledAt?: string;
  /**
   * When set, a running instance is hidden from the Overdue list until this
   * timestamp passes (then it resurfaces as Overdue). Set by the postpone
   * action so users can grant an instance more time after reviewing it.
   */
  overdueSnoozedUntil?: string;
  launchedBy?: string;
  recordId?: string;
  instanceUrl?: string;
  completionCounted?: boolean;
  countedAsFailed?: boolean;
  /**
   * Free-form labels users stick on an instance to organize them. Shared across
   * everyone in the org (stored on the instance record), so a tag added by one
   * member is visible to all. Set via PUT /api/instances/:id/tags.
   */
  tags?: string[];
}

/** DB-mapped type. Frontend refers to this as `Automation`. */
export interface AutomationRule {
  id: string;
  orgId: string;
  name: string;
  connectionId?: string;
  appId?: string;              // alternative to connectionId for installed apps
  appSlug?: AppSlug;
  sourcePlatform: Platform;
  eventType: string;
  eventLabel: string;
  conditions?: Record<string, any>;
  conditionsDisplay?: string;
  actionType: string;
  targetWorkflowId?: string;
  actionConfig?: Record<string, any>;
  webhookKey?: string;         // per-automation 64-char hex capability token
  status: RuleStatus;
  retryMaxAttempts: number;
  retryStrategy: RetryStrategy;
  retryIntervalSec: number;
  timesTriggered: number;
  lastTriggeredAt?: string;
  successRate: number;
  failureCount: number;
  lastError?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface TriggerPipelineEntry {
  id: string;
  orgId: string;
  ruleId?: string;
  sourcePlatform: Platform;
  eventType: EventCategory;
  eventSummary: string;
  rawPayload?: Record<string, any>;
  actionDescription: string;
  workflowInstanceId?: string;
  status: PipelineStatus;
  errorMessage?: string;
  userMessage?: string;
  adminMessage?: string;
  errorCategory?: ErrorCategory;
  userActionable: boolean;
  attributedTo?: string;
  triggeredAt: string;
  completedAt?: string;
  durationMs?: number;
  attemptNumber: number;
  nextRetryAt?: string;
  webhookEventId?: string;
  actionNumber?: number;
}

export interface QueuedWebhook {
  id: string;
  ruleId: string;
  orgId: string;
  platform: Platform;
  eventType: string;
  eventSummary: string;
  rawPayload: Record<string, any>;
  mappedInputs?: Record<string, any>;
  webhookEventId?: string;
  queuedAt: string;
  status: 'queued' | 'released' | 'cancelled';
  releasedAt?: string;
  cancelledAt?: string;
}

export interface AuditLogEntry {
  id: string;
  orgId: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface WebhookEvent {
  id: string;
  platform: Platform;
  connectionId?: string;
  eventType?: string;
  payload: Record<string, any>;
  headers?: Record<string, any>;
  signatureValid?: boolean;
  processed: boolean;
  processedAt?: string;
  error?: string;
  receivedAt: string;
}

export interface Notification {
  id: string;
  orgId: string;
  recipientId: string;
  eventType: NotificationEventType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  triggerPipelineId?: string;
  workflowInstanceId?: string;
  connectionId?: string;
  channelsSent?: string[];
  readAt?: string;
  dismissedAt?: string;
  createdAt: string;
}

// ─── API Error Response ──────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  details?: Record<string, any>;
}

// ─── SQS Job Types ───────────────────────────────────────────

export interface WebhookProcessingJob {
  eventId: string;
  platform: Platform;
  orgId: string;
  connectionId: string;
  requestId?: string;
  /** When set, only this specific rule is evaluated (per-rule webhook endpoint). */
  ruleId?: string;
  /**
   * Correlation id from SF Apex `X-Baton-Dispatch-Id` header — same UUID as the
   * payload's `eventId`. Propagated so the Maestro launcher can stamp it on its
   * own logs, letting one grep tie SF Task → Baton ingest → workflow instance.
   */
  sfDispatchId?: string;
}

export interface WorkflowLaunchJob {
  ruleId: string;
  ruleName?: string;
  actionNumber?: number;
  sourcePlatform?: string;
  pipelineEntryId: string;
  workflowId: string;
  orgId: string;
  inputData: Record<string, any>;
  instanceName: string;
  requestId?: string;
  /** End-to-end correlation id from SF Apex (only set for sourcePlatform === 'salesforce'). */
  sfDispatchId?: string;
  /** Retry metadata — present when this is a retry attempt */
  retry?: {
    attempt: number;         // 1-based: which retry attempt this is (1–6)
    maxAttempts: number;     // total retry attempts allowed (6)
    sequenceId: string;      // unique ID per retry sequence; reset on manual retry
    instanceId?: string;     // existing WorkflowInstance ID to update (not create new)
    /** ISO timestamp — if set and in the future, re-enqueue (SQS 900s cap workaround) */
    deferUntil?: string;
  };
}

export interface TokenRefreshJob {
  connectionId: string;
  orgId: string;
  platform: Platform;
}

export interface NotificationJob {
  orgId: string;
  recipientId: string;
  eventType: NotificationEventType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  context?: Record<string, any>;
}

// ─── Slack ──────────────────────────────────────────────────────

/** Per-org Slack Bot configuration stored in baton-slack-configs */
export interface SlackConfig {
  orgId: string;           // PK — one record per org
  enabled: boolean;
  /**
   * Channel routing: event category → Slack channel ID/#name, or `null` to
   * suppress the event entirely. `undefined`/missing falls back to `default`.
   * `default: null` means there is no fallback — unrouted events are not sent.
   */
  channelRouting: {
    default: string | null;
    workflow_failed?: string | null;
    workflow_completed?: string | null;
    workflow_launched?: string | null;
    workflow_synced?: string | null;
    rule_error?: string | null;
    retry_exhausted?: string | null;
    webhook_failed?: string | null;
    connection_degraded?: string | null;
    connection_created?: string | null;
    connection_disconnected?: string | null;
    execution_quota_exceeded?: string | null;
    execution_quota_warning?: string | null;
  };
  /** Optional per-org bot token (future multi-workspace).
   *  If absent, global env.SLACK_BOT_TOKEN is used. */
  botTokenEnc?: string;
  /** Populated on first successful delivery */
  teamId?: string;
  teamName?: string;
  updatedAt: string;
  updatedBy?: string;
}

// ─── Bootstrap Tokens (SF Managed Package v0.3+ registration flow) ───────

/**
 * One-time-use token issued by Baton when an admin creates an SF automation.
 * Embedded in the webhook URL given to the customer:
 *   https://app.iambaton.com/api/webhooks/rule/<ruleId>?bootstrap=<tokenId>
 *
 * The Salesforce managed package detects the bootstrap param on first webhook
 * dispatch, generates an HMAC secret in Apex, and posts it to
 * POST /api/salesforce/webhook-registrations to redeem the token in exchange
 * for the secret being persisted on Baton's side (in OrgApp.secretKeyEnc).
 *
 * After redemption: `redeemed = true`, the token cannot be reused.
 * Idempotency: if a request comes in with the same idempotencyKey AND the
 * token is already redeemed, return the cached registrationResponse instead
 * of creating a duplicate.
 */
export interface BootstrapToken {
  /** PK — the token itself, e.g. `btn_t9ZqK3...`. High-entropy 32+ chars. */
  tokenId: string;
  /** AutomationRule.webhookKey — matches the URL path the customer pastes into Flow Builder.
   *  Used to resolve the OrgApp on redeem (rule.webhookKey → rule.appId → OrgApp). */
  webhookKey: string;
  /** Baton org that issued the token (for audit + multi-tenant guard). */
  orgId: string;
  /** Audit trail. */
  createdAt: string;
  /** Unix epoch seconds. DDB TTL field — record auto-deleted after this. */
  expiresAt: number;
  /** Flipped to true on successful redemption; subsequent attempts hit the idempotency path. */
  redeemed: boolean;
  redeemedAt?: string;
  /** Salesforce Org Id (15- or 18-char) that redeemed; locks token to this SF org. */
  redeemedBySfOrgId?: string;
  /** Idempotency-Key header from the registration request (typically `<sfOrgId>_<ruleId>_<tokenId>`). */
  idempotencyKey?: string;
  /** Cached registration response — returned verbatim on idempotent retry.
   *  `secret` carries the EFFECTIVE HMAC secret stored on the backend; SF Apex
   *  must use this (not its locally generated value) to populate the cached
   *  Custom Setting. Without this echo, an Apex DML failure on first request
   *  followed by a retry would cause SF to save a freshly generated secret
   *  while Baton already has the original — every subsequent webhook would
   *  fail signature verification. */
  registrationResponse?: {
    status: 'registered';
    webhookId: string;
    secret: string;
    secretVersion: number;
    expiresAt: string | null;
  };
  /**
   * Flipped to true once the secret has actually been written to
   * OrgApp.sfRegistrations. The redemption and the OrgApp write are two
   * separate DDB operations; if the process crashes in between, the token is
   * redeemed but the backend never stored the secret — every webhook from
   * that SF org would 401 forever. Idempotent replays check this flag and
   * re-persist the cached secret (self-heal) when it is not yet true.
   */
  persisted?: boolean;
}

/**
 * DocOverride — FluidLabs-editable documentation content for one /docs page.
 *
 * When a `published` override exists for a slug, the docs reader renders its
 * Markdown instead of the hardcoded TSX page. Global (not org-scoped) — the
 * product docs are identical for every reader. Written only by staff
 * (enforced server-side by requireStaffAccess).
 */
export interface DocOverride {
  /** The /docs page slug — also the table's partition key. */
  slug: string;
  /** Markdown body (may contain `::demo[...]` / `:::callout` directive shortcodes). */
  contentMarkdown: string;
  status: 'published';
  /** User id of the last editor. */
  updatedBy: string;
  /** Editor's email at save time (audit trail). */
  updatedByEmail: string;
  /** Editor's display name at save time, if available. */
  updatedByName?: string;
  /** ISO timestamp of the last save. */
  updatedAt: string;
  /** Monotonic save counter, bumped on every PUT. */
  version: number;
}
