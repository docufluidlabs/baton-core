import useSWR from 'swr';
import { fetcher, api } from '@/lib/api';
import { toast } from 'sonner';

// ─── Types ───────────────────────────────────────────────────

export interface Connection {
  id: string;
  platform: string;
  displayName: string;
  status: 'healthy' | 'warning' | 'error' | 'pending';
  accountId?: string;
  metadata?: Record<string, unknown>;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  /** Webhook URL returned by the backend for this connection (if applicable). */
  webhookUrl?: string;
  createdAt: string;
  updatedAt?: string;
}

// ─── Trigger Input Schema ────────────────────────────────────
// Maestro returns two formats; we type them explicitly to avoid `as any` casts.

/** Maestro array format: [{ field_name, field_data_type, default_value }] */
export interface MaestroSchemaField {
  field_name: string;
  field_data_type: string;
  default_value?: string;
}

/** JSON Schema format: { properties: { ... }, required: [...] } */
export interface JsonSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
}

export interface JsonSchemaFormat {
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export type TriggerInputSchema = MaestroSchemaField[] | JsonSchemaFormat;

/** Parsed field — unified output from both schema formats */
export interface SchemaField {
  key: string;
  label: string;
  type: string;
  dataType: string;
  enum?: string[];
  required: boolean;
  defaultValue?: string;
}

const MAESTRO_SYSTEM_FIELDS = new Set(['startDate', 'workflowBuilder', 'workflowPreparer', 'workflowSigner']);

/**
 * Parse triggerInputSchema (either Maestro array or JSON Schema) into a flat field list.
 * Filters out Maestro system fields and Participants type.
 */
export function parseTriggerInputSchema(schema: TriggerInputSchema | undefined | null): SchemaField[] {
  if (!schema) return [];

  // Maestro array format
  if (Array.isArray(schema)) {
    return schema
      .filter((item) => item.field_name && !MAESTRO_SYSTEM_FIELDS.has(item.field_name) && item.field_data_type !== 'Participants')
      .map((item) => ({
        key: item.field_name,
        label: item.field_name,
        type: item.field_data_type === 'Float' ? 'number' : 'string',
        dataType: item.field_data_type || 'String',
        enum: undefined,
        required: false,
        defaultValue: item.default_value,
      }));
  }

  // JSON Schema format
  if (schema.properties && typeof schema.properties === 'object') {
    const req = new Set(schema.required ?? []);
    return Object.entries(schema.properties)
      .filter(([key]) => !MAESTRO_SYSTEM_FIELDS.has(key))
      .map(([key, prop]) => ({
        key,
        label: prop.title || prop.description || key,
        type: prop.type || 'string',
        dataType: prop.type || 'string',
        enum: prop.enum,
        required: req.has(key),
        defaultValue: undefined,
      }));
  }

  return [];
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  maestroWorkflowId: string;
  maestroStatus: string;
  connectionId?: string;
  triggerType?: string;
  triggerInputSchema?: TriggerInputSchema;
  launchCount: number;
  lastLaunchedAt?: string;
  maestroUrl?: string;
  maestroInstancesUrl?: string;
  createdAt: string;
  updatedAt?: string;
  maestroUpdatedAt?: string;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  maestroInstanceId: string;
  instanceName: string;
  status: string;
  currentStep?: string;
  lastCompletedStep?: number;
  lastCompletedStepName?: string;
  totalSteps?: number;
  startedAt: string;
  completedAt?: string;
  inputData?: Record<string, unknown>;
  launchedBy?: string;
  triggerRuleId?: string;
  triggerRuleName?: string;
  triggerActionNumber?: number;
  sourcePlatform?: string;
  instanceUrl?: string;
  errorMessage?: string;
  errorStep?: string;
  startedByName?: string;
  startedByRole?: string;
  expiresAt?: string;
  retryCount?: number;
  retryMaxAttempts?: number;
  nextRetryAt?: string;
  manuallyRetriedAt?: string;
  manuallyCancelledAt?: string;
  /** While in the future, hides a running instance from Overdue (set by postpone). */
  overdueSnoozedUntil?: string;
  /** Org-shared free-form labels. Undefined means tags were never set on the server. */
  tags?: string[];
}

export interface Automation {
  id: string;
  name: string;
  orgId: string;
  connectionId?: string;
  appId?: string;
  appSlug?: string;
  sourcePlatform: string;
  eventType: string;
  eventLabel: string;
  conditions?: Record<string, unknown>;
  conditionsDisplay?: string;
  targetWorkflowId: string;
  actionConfig: Record<string, unknown>;
  webhookKey?: string;
  webhookUrl?: string;
  status: 'active' | 'paused' | 'error' | 'disabled';
  timesTriggered: number;
  failureCount: number;
  runningCount?: number;
  cancelledCount?: number;
  successRate?: number;
  lastTriggeredAt?: string;
  retryMaxAttempts?: number;
  retryStrategy?: string;
  retryIntervalSec?: number;
  createdAt: string;
}

export interface PipelineEvent {
  id: string;
  orgId: string;
  eventType: string;
  status: string;
  eventSummary?: string;
  sourcePlatform?: string;
  triggeredAt: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  ruleId?: string;
  actionDescription?: string;
  userMessage?: string;
  userActionable?: boolean;
  rawPayload?: Record<string, unknown>;
  workflowInstanceId?: string;
  attemptNumber?: number;
  attributedTo?: string;
  webhookEventId?: string;
}

export interface AttentionItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  platform?: string;
  timestamp: string;
  actionUrl?: string;
}

export interface DashboardData {
  overview: {
    connections: { total: number; healthy: number; warning: number; error: number };
    workflows: { total: number; active: number; totalLaunches: number };
    automations: { total: number; active: number; paused: number; error: number };
    events24h: { total: number; failed: number };
  };
  attentionItems: AttentionItem[];
  recentEvents: PipelineEvent[];
  recentInstances: WorkflowInstance[];
  connections: Connection[];
}

export interface PlatformMeta {
  platform: string;
  displayName: string;
  eventTypes: Array<{ eventType: string; label: string; description: string }>;
}

export interface InstalledPlatform {
  id: string;
  orgId?: string;
  appSlug: string;
  displayName: string;
  webhookKey: string;
  webhookUrl: string;
  status: 'active' | 'inactive';
  addedAt: string;
  addedBy?: string;
  lastWebhookAt?: string;
  webhookCount?: number;
  // catalog enrichment (added by GET /api/platforms)
  name?: string;
  logoUrl?: string;
  icon?: string;
  category?: string;
  supportedEvents?: PlatformEventType[];
}

export interface PlatformEventType {
  eventType: string;
  label: string;
  description: string;
}

export interface PlatformSetupStep {
  step: number;
  title: string;
  description: string;
  screenshotHint?: string;
}

export interface PlatformTemplate {
  slug: string;
  name: string;
  description: string;
  logoUrl?: string;
  category: string;
  icon: string;
  secretKeyLabel: string;
  secretKeyHint: string;
  secretUsernameLabel?: string;
  secretPasswordLabel?: string;
  setupInstructions: PlatformSetupStep[];
  supportedEvents: PlatformEventType[];
  webhookCapable: true;
}

// ─── Notification ──────────────────────────────────────────
// Single shared type for both NotificationsPanel and NotificationsPage.
// The API field is "message" — NotificationsPage was using "body" which rendered empty.

export interface Notification {
  id: string;
  title: string;
  /** Body text of the notification (API field name: "message") */
  message: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  eventType: string;
  category?: string;
  actionUrl?: string;
  readAt?: string;
  dismissedAt?: string;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

export interface WebhookEndpoint {
  id: string;
  name: string;
  platform: string;
  workflowId: string;
  payloadFieldPath: string;
  apiKey?: string;
  hasApiKey?: boolean;
  rateLimitPerMinute: number;
  enabled: boolean;
  requestCount: number;
  lastRequestAt?: string;
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Hooks ───────────────────────────────────────────────────

export function useDashboard() {
  return useSWR<DashboardData>('/dashboard', fetcher, { refreshInterval: 15_000 });
}

export function useConnections(options?: { refreshInterval?: number }) {
  return useSWR<{ connections: Connection[] }>('/connections', fetcher, options);
}

export function usePlatforms() {
  return useSWR<{ platforms: PlatformMeta[] }>('/connections/platforms', fetcher);
}

export interface DocusignSetupStatus {
  /** true when the server has both DOCUSIGN_INTEGRATION_KEY and DOCUSIGN_SECRET_KEY */
  configured: boolean;
  /** Exact OAuth redirect URI to register in the DocuSign app (Apps & Keys) */
  redirectUri: string;
  /** DocuSign OAuth base — contains 'account-d' when pointing at the developer sandbox */
  oauthBase: string;
  developerPortalUrl: string;
}

/** Whether the server's DocuSign OAuth app is configured. When it is not,
 *  the Connections page shows the guided one-time provider-app setup
 *  (n8n-style: exact redirect URI to copy) instead of a doomed Connect button. */
export function useDocusignSetupStatus() {
  return useSWR<DocusignSetupStatus>('/connections/docusign/setup-status', fetcher);
}

export function useWorkflows(options?: { refreshInterval?: number }) {
  return useSWR<{ workflows: Workflow[] }>('/workflows', fetcher, options);
}

export function useWorkflowInstances(workflowId: string, live = false) {
  return useSWR<{ instances: WorkflowInstance[] }>(
    workflowId ? `/workflows/${workflowId}/instances?live=${live}` : null,
    fetcher,
    { refreshInterval: live ? 10_000 : 0 },
  );
}

export function useInstances(params?: { status?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return useSWR<{ instances: WorkflowInstance[] }>(
    `/instances${qs ? `?${qs}` : ''}`,
    fetcher,
    { refreshInterval: 10_000 },
  );
}

export function useAutomationInstances(ruleId: string | null) {
  return useSWR<{ instances: WorkflowInstance[] }>(
    ruleId ? `/instances?ruleId=${ruleId}&limit=100` : null,
    fetcher,
    { refreshInterval: 10_000 },
  );
}

export async function retryInstance(instanceId: string): Promise<void> {
  await api.post(`/instances/${instanceId}/retry`);
}

/** Grant an overdue instance `days` more time — it returns to In Progress and
 *  resurfaces as Overdue only after that window elapses. */
export async function postponeInstance(instanceId: string, days: number): Promise<void> {
  await api.post(`/instances/${instanceId}/postpone`, { days });
}

/** Replace the org-shared tags on an instance. Returns the normalized list the
 *  server stored (trimmed/deduped), which may differ from what was sent. */
export async function setInstanceTags(instanceId: string, tags: string[]): Promise<string[]> {
  const res = await api.put<{ id: string; tags: string[] }>(`/instances/${instanceId}/tags`, { tags });
  return res.tags;
}

export type InstanceStatusCounts = Record<string, { completed: number; failed: number; cancelled: number; running: number }>;

export function useInstanceCounts() {
  return useSWR<{ counts: InstanceStatusCounts }>('/instances/counts', fetcher, { refreshInterval: 15_000 });
}

export function useAutomations(options?: { refreshInterval?: number }) {
  return useSWR<{ automations: Automation[] }>('/automations', fetcher, options);
}

export function useAutomationEventTypes(platform: string) {
  return useSWR<{ eventTypes: Array<{ eventType: string; label: string }> }>(
    platform ? `/automations/event-types/${platform}` : null,
    fetcher,
  );
}

export function useAutomationHistory(automationId: string | null) {
  return useSWR<{ history: PipelineEvent[] }>(
    automationId ? `/automations/${automationId}/history` : null,
    fetcher,
  );
}

export interface WebhookEvent {
  id: string;
  platform: string;
  connectionId?: string;
  eventType?: string;
  payload: Record<string, unknown>;
  headers?: Record<string, unknown>;
  signatureValid?: boolean;
  processed: boolean;
  processedAt?: string;
  error?: string;
  receivedAt: string;
}

export interface AutomationAction {
  actionNumber: number | null;
  pipelineEntryId: string;
  webhookEventId: string | null;
  triggeredAt: string;
  status: 'launched' | 'running' | 'failed';
  signatureValid: boolean | null;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  userMessage: string | null;
  instance: {
    id: string;
    maestroInstanceId: string | null;
    status: string;
    retryCount: number;
    retryMaxAttempts: number | null;
    nextRetryAt: string | null;
    errorMessage: string | null;
    inputData: Record<string, unknown> | null;
  } | null;
}

export function useAutomationActions(ruleId: string | null) {
  return useSWR<{ actions: AutomationAction[] }>(
    ruleId ? `/automations/${ruleId}/actions` : null,
    fetcher,
    { refreshInterval: 10_000 },
  );
}

export interface QueuedWebhook {
  id: string;
  ruleId: string;
  platform: string;
  eventType: string;
  eventSummary: string;
  queuedAt: string;
  status: 'queued' | 'released' | 'cancelled';
}

export function useAutomationQueue(ruleId: string | null, enabled = true) {
  return useSWR<{ items: QueuedWebhook[]; count: number }>(
    ruleId && enabled ? `/automations/${ruleId}/queue` : null,
    fetcher,
    { refreshInterval: 10_000 },
  );
}

export async function releaseQueuedWebhook(ruleId: string, itemId: string): Promise<void> {
  await api.post(`/automations/${ruleId}/queue/${itemId}/release`);
}

export async function cancelQueuedWebhook(ruleId: string, itemId: string): Promise<void> {
  await api.delete(`/automations/${ruleId}/queue/${itemId}`);
}

export function useAutomationWebhooks(ruleId: string | null) {
  return useSWR<{ webhooks: WebhookEvent[] }>(
    ruleId ? `/automations/${ruleId}/webhooks` : null,
    fetcher,
    { refreshInterval: 15_000 },
  );
}

interface EventsResponse {
  events: PipelineEvent[];
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export function useEvents(params?: { limit?: number; category?: string; status?: string; platform?: string; includeUnmatched?: boolean }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.category) query.set('category', params.category);
  if (params?.status) query.set('status', params.status);
  if (params?.platform) query.set('platform', params.platform);
  if (params?.includeUnmatched !== false) query.set('include_unmatched', 'true');
  const qs = query.toString();
  return useSWR<EventsResponse>(`/events${qs ? `?${qs}` : ''}`, fetcher, {
    refreshInterval: 15_000,
  });
}

export async function fetchEventsPage(params: {
  limit?: number;
  category?: string;
  status?: string;
  platform?: string;
  cursor?: string;
  includeUnmatched?: boolean;
}): Promise<EventsResponse> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.category) query.set('category', params.category);
  if (params.status) query.set('status', params.status);
  if (params.platform) query.set('platform', params.platform);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.includeUnmatched !== false) query.set('include_unmatched', 'true');
  const qs = query.toString();
  return api.get<EventsResponse>(`/events${qs ? `?${qs}` : ''}`);
}

export function useInstalledPlatforms() {
  return useSWR<{ platforms: InstalledPlatform[] }>('/platforms', fetcher);
}

export function usePlatformTemplates() {
  return useSWR<{ templates: PlatformTemplate[] }>('/platforms/catalog', fetcher);
}

export function useEventStats() {
  return useSWR<{ stats: Record<string, unknown> }>('/events/stats', fetcher, {
    refreshInterval: 30_000,
  });
}

// ─── Mutations ───────────────────────────────────────────────

export async function connectPlatform(platform: string) {
  const res = await api.post<{ redirectUrl: string }>(`/connections/${platform}/authorize`);
  window.location.href = res.redirectUrl;
}

export async function disconnectConnection(id: string) {
  await api.delete(`/connections/${id}`);
  toast.success('Connection removed');
}

export async function testConnection(id: string) {
  const res = await api.post<{ healthy: boolean; message?: string; details?: { name?: string; email?: string } }>(`/connections/${id}/test`);
  if (res.healthy) {
    toast.success(res.message || 'Connection is healthy');
  } else {
    toast.error(res.message || 'Connection has issues');
  }
  return res;
}

export async function refreshConnectionToken(id: string) {
  await api.post(`/connections/${id}/refresh`);
  toast.success('Token refreshed');
}

/**
 * Sync workflows from DocuSign Maestro.
 *
 * Fix: client-side connection lookup removed. Previously the frontend fetched
 * all connections, found DocuSign, and passed connectionId to the backend —
 * leaking backend business logic into the client and breaking if more than
 * one DocuSign connection exists. The backend now determines the active one.
 */
export async function syncWorkflows() {
  const res = await api.post<{ workflows: Workflow[]; synced: number }>('/workflows/sync');
  toast.success(`Synced ${res.synced ?? res.workflows?.length ?? 0} workflows from Maestro`);
  return res;
}

export async function syncSingleWorkflow(workflowId: string) {
  const res = await api.post<{ message: string; triggerInputSchema?: TriggerInputSchema; triggerType?: string }>(`/workflows/${workflowId}/sync`);
  toast.success('Workflow synced');
  return res;
}

export async function createWorkflow(data: {
  name: string;
  description?: string;
  maestroWorkflowId?: string;
  connectionId?: string;
  triggerInputSchema?: TriggerInputSchema;
  tags?: string[];
}) {
  const res = await api.post<{ workflow: Workflow }>('/workflows', data);
  toast.success('Workflow created');
  return res;
}

export async function updateWorkflow(id: string, data: Partial<{
  name: string;
  description: string;
  connectionId: string;
  triggerInputSchema: TriggerInputSchema;
  tags: string[];
}>) {
  const res = await api.patch<{ message: string }>(`/workflows/${id}`, data);
  toast.success('Workflow updated');
  return res;
}

export async function launchWorkflow(workflowId: string, instanceName: string, triggerInputs?: Record<string, unknown>) {
  const res = await api.post<{ instance: WorkflowInstance }>(`/workflows/${workflowId}/launch`, {
    instanceName,
    triggerInputs,
  });
  toast.success('Workflow launched');
  return res;
}

export async function cancelInstance(instanceId: string) {
  const res = await api.post<{ message: string }>(`/instances/${instanceId}/cancel`);
  toast.success('Instance cancelled');
  return res;
}

/** Pre-generate a per-automation webhook URL (no DB write). */
export async function preflightAutomation(sourcePlatform?: string): Promise<{ webhookKey: string; webhookUrl: string }> {
  return api.post<{ webhookKey: string; webhookUrl: string }>('/automations/preflight', { sourcePlatform });
}

export async function createAutomation(data: Partial<Automation> & { webhookKey?: string }) {
  const res = await api.post<{ automation: Automation }>('/automations', data);
  toast.success('Automation created');
  return res;
}

export async function updateAutomationStatus(id: string, action: 'pause' | 'resume') {
  await api.post(`/automations/${id}/${action}`);
  toast.success(action === 'pause' ? 'Automation paused' : 'Automation resumed');
}

export async function updateAutomation(id: string, data: Partial<Automation>) {
  const res = await api.patch<{ automation: Automation }>(`/automations/${id}`, data);
  toast.success('Automation updated');
  return res;
}

export async function deleteAutomation(id: string) {
  await api.delete(`/automations/${id}`);
  toast.success('Automation deleted');
}

export async function updateConnectionWebhookSecret(connectionId: string, secret: string) {
  await api.patch(`/connections/${connectionId}/webhook-secret`, { secret });
  toast.success('Webhook secret updated');
}

export async function updateAppWebhookSecret(appId: string, secret: string) {
  await api.patch(`/platforms/${appId}/webhook-secret`, { secret });
  toast.success('Webhook secret updated');
}

/** Step 1 of install wizard: get a pre-generated webhookKey without saving anything */
export async function preflightPlatform(appSlug: string): Promise<{ webhookKey: string; webhookUrl: string }> {
  return api.post<{ webhookKey: string; webhookUrl: string }>('/platforms/preflight', { appSlug });
}

/** Install a platform — secretKey is optional (can be added later via Flow Builder) */
export async function installPlatform(data: {
  appSlug: string;
  secretKey?: string;
  displayName?: string;
  webhookKey?: string;
}): Promise<{ platform: InstalledPlatform }> {
  const res = await api.post<{ platform: InstalledPlatform }>('/platforms', data);
  return res;
}

export async function removePlatform(id: string) {
  await api.delete(`/platforms/${id}`);
  toast.success('Platform removed');
}

// ─── Webhook Endpoints ──────────────────────────────────────

export function useWebhookEndpoints(options?: { refreshInterval?: number }) {
  return useSWR<{ endpoints: WebhookEndpoint[] }>('/webhook-endpoints', fetcher, options);
}

export async function createWebhookEndpoint(data: {
  name: string;
  platform: string;
  workflowId: string;
  payloadFieldPath: string;
  apiKey?: string;
  generateApiKey?: boolean;
  rateLimitPerMinute?: number;
}) {
  const res = await api.post<{ endpoint: WebhookEndpoint }>('/webhook-endpoints', data);
  toast.success('Webhook endpoint created');
  return res;
}

export async function updateWebhookEndpoint(id: string, data: Partial<{
  name: string;
  workflowId: string;
  payloadFieldPath: string;
  apiKey: string;
  generateApiKey: boolean;
  rateLimitPerMinute: number;
  enabled: boolean;
}>) {
  const res = await api.patch<{ message: string }>(`/webhook-endpoints/${id}`, data);
  toast.success('Webhook endpoint updated');
  return res;
}

export async function deleteWebhookEndpoint(id: string) {
  await api.delete(`/webhook-endpoints/${id}`);
  toast.success('Webhook endpoint deleted');
}

export async function regenerateEndpointKey(id: string) {
  const res = await api.post<{ apiKey: string }>(`/webhook-endpoints/${id}/regenerate-key`);
  toast.success('API key regenerated');
  return res;
}

// ─── Slack ─────────────────────────────────────────────────

/**
 * Per-org Slack channel routing.
 *   string  → send this event to that channel
 *   null    → "Don't send" — suppress this event entirely
 *   missing → fall back to `default`
 *   default itself can be null, meaning unrouted events are not sent
 */
export interface SlackChannelRouting {
  default: string | null;
  workflow_failed?: string | null;
  workflow_completed?: string | null;
  workflow_launched?: string | null;
  automation_failed?: string | null;
  connection_degraded?: string | null;
  webhook_failed?: string | null;
}

export interface SlackConfig {
  orgId: string;
  enabled: boolean;
  channelRouting: SlackChannelRouting;
  teamId?: string;
  teamName?: string;
  updatedAt?: string;
}

export interface SlackConfigResponse {
  config: SlackConfig;
  /** true when a per-org bot token is stored (OAuth installed) */
  connected: boolean;
  teamName?: string;
  teamId?: string;
}

export function useSlackConfig() {
  return useSWR<SlackConfigResponse>('/slack/config', fetcher);
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  num_members: number;
}

export function useSlackChannels(enabled: boolean) {
  return useSWR<{ channels: SlackChannel[] }>(
    enabled ? '/slack/channels' : null,
    fetcher,
    { revalidateOnFocus: false },
  );
}

export async function updateSlackConfig(data: {
  enabled: boolean;
  channelRouting: SlackChannelRouting;
}): Promise<void> {
  await api.put('/slack/config', data);
}

export async function disconnectSlack(): Promise<void> {
  await api.delete('/slack/config');
}

/** Fetch the Slack OAuth authorization URL and navigate the browser to it */
export async function installSlackApp(): Promise<void> {
  const { url } = await api.get<{ url: string }>('/slack/oauth/install');
  window.location.href = url;
}

export async function testSlackNotification(): Promise<{ message: string }> {
  return api.post<{ message: string }>('/slack/test');
}

// ─── Flow Layout ─────────────────────────────────────────────

export type FlowPositions = Record<string, { x: number; y: number }>;

export async function getFlowLayout(): Promise<FlowPositions> {
  const res = await api.get<{ positions: FlowPositions }>('/flow-layout');
  return res.positions ?? {};
}

export async function saveFlowLayout(positions: FlowPositions): Promise<void> {
  await api.patch('/flow-layout', { positions });
}

// ─── Notification Preferences ────────────────────────────────

export type NotifChannel = 'inApp' | 'email';

export interface EventChannelPrefs {
  inApp: boolean;
  email: boolean;
}

export interface NotificationPreferencesData {
  /** Per-event-type, per-channel toggles. Slack delivery is configured
   *  separately under Slack → Channel Routing. */
  events: Record<string, EventChannelPrefs>;
}

const DEFAULT_EVENT_PREFS: Record<string, EventChannelPrefs> = {
  workflow_failed:           { inApp: true,  email: true  },
  workflow_completed:        { inApp: true,  email: false },
  workflow_launched:         { inApp: true,  email: false },
  automation_failed:         { inApp: true,  email: true  },
  connection_degraded:       { inApp: true,  email: true  },
  webhook_failed:            { inApp: true,  email: true  },
};

export { DEFAULT_EVENT_PREFS };

export function useNotificationPreferences() {
  return useSWR<{ preferences: NotificationPreferencesData }>(
    '/notifications/preferences',
    fetcher,
  );
}

export async function updateNotificationPreferences(
  prefs: NotificationPreferencesData,
): Promise<void> {
  await api.put('/notifications/preferences', prefs);
}

// ─── Auth ───────────────────────────────────────────────────

interface MeResponse {
  user: { id: string; email?: string; role: string };
  organization: {
    id: string;
    name?: string;
    plan: string;
    features: string[];
    executionsUsed?: number;
  };
}

export function useMe() {
  return useSWR<MeResponse>('/auth/me', fetcher);
}
