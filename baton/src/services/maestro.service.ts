/**
 * Maestro Service — Baton
 * 
 * DocuSign Maestro workflow API client.
 * 
 * Key differences from original:
 *   - Dynamic workflowId per call (not from env)
 *   - Token from platform_connections table (not DynamoDB token store)
 *   - Multi-account support (multiple DocuSign accounts per org)
 *   - Configurable API base URL from connection metadata
 */

import { logInfo, logError, logDebug } from '../lib/logger';
import * as connectionService from './connection.service';
import { getConnector } from './connectors';
import env from '../env';

// ─── Types ───────────────────────────────────────────────────

export interface MaestroWorkflow {
  id: string;
  name: string;
  status: string;
  triggerEventType?: string;
  description?: string;
  stepCount?: number;
  updatedAt?: string;
}

export interface MaestroTriggerRequirements {
  triggerEventType: string;
  triggerHttpConfig?: Record<string, any>;
  triggerInputSchema?: Record<string, any>;
}

export interface LaunchWorkflowParams {
  connectionId: string;       // DocuSign connection ID
  workflowId: string;         // Maestro workflow ID
  instanceName: string;
  triggerInputs: Record<string, any>;
}

export interface WorkflowInstanceResult {
  instanceId: string;
  instanceUrl: string;
}

export interface MaestroInstance {
  id: string;
  instanceName: string;
  workflowId: string;
  workflowName?: string;
  status: string;
  lastStep?: string;
  lastCompletedStep?: number;
  lastCompletedStepName?: string;
  totalSteps?: number;
  startDate?: string;
  endDate?: string;
  instanceUrl: string;
  startedBy?: string;
  startedByName?: string;
}

// ─── Helper: get valid access token ─────────────────────────

async function getValidAccessToken(connectionId: string): Promise<{ accessToken: string; accountId: string; apiBase: string }> {
  const connection = await connectionService.getConnection(connectionId);
  if (!connection) throw new Error(`Connection ${connectionId} not found`);
  if (connection.platform !== 'docusign') throw new Error(`Connection ${connectionId} is not a DocuSign connection`);

  const connector = getConnector('docusign');

  // Check if token is expired and refresh if needed
  if (connection.tokenExpiresAt) {
    const expiresAt = new Date(connection.tokenExpiresAt).getTime();
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5 minutes

    if (now >= expiresAt - bufferMs) {
      if (!connection.refreshTokenEnc) {
        throw new Error('DocuSign token expired and no refresh token available. Please reconnect DocuSign.');
      }
      logInfo('Refreshing expired DocuSign token', { connectionId });
      const refreshToken = await connectionService.getRefreshToken(connectionId);
      const newTokens = await connector.refreshToken(refreshToken);
      await connectionService.updateTokens(connectionId, newTokens);
      return {
        accessToken: newTokens.accessToken,
        accountId: connection.accountId || env.DOCUSIGN_ACCOUNT_ID,
        apiBase: env.DOCUSIGN_MAESTRO_API_BASE,
      };
    }
  }

  const accessToken = await connectionService.getAccessToken(connectionId);
  return {
    accessToken,
    accountId: connection.accountId || env.DOCUSIGN_ACCOUNT_ID,
    apiBase: env.DOCUSIGN_MAESTRO_API_BASE,
  };
}

// Timeout for all Maestro API calls (#18):
// If DocuSign Maestro hangs, we must not block the event loop indefinitely.
const MAESTRO_TIMEOUT_MS = 15_000;

// ─── Public API ──────────────────────────────────────────────

/**
 * List all workflows for an account
 * Ported from: getWorkflowsList()
 */
export async function listWorkflows(connectionId: string, status: string = 'active'): Promise<MaestroWorkflow[]> {
  const { accessToken, accountId, apiBase } = await getValidAccessToken(connectionId);

  logInfo('Fetching Maestro workflows list', { accountId, status });

  const url = `${apiBase}/v1/accounts/${accountId}/workflows`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(MAESTRO_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list workflows: ${response.status} ${errorText}`);
  }

  const data: any = await response.json();
  let workflows = data.data || [];

  if (status !== 'all') {
    workflows = workflows.filter((w: any) => w.status === status);
  }

  return workflows.map((w: any) => ({
    id: w.id,
    name: w.name,
    status: w.status,
    description: w.description,
    updatedAt: w.updated_at ?? w.updatedAt,
  }));
}

/**
 * Get trigger requirements for a workflow
 * Ported from: getWorkflowTriggerRequirements()
 */
export async function getTriggerRequirements(
  connectionId: string,
  workflowId: string,
): Promise<MaestroTriggerRequirements> {
  const { accessToken, accountId, apiBase } = await getValidAccessToken(connectionId);

  const url = `${apiBase}/v1/accounts/${accountId}/workflows/${workflowId}/trigger-requirements`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(MAESTRO_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get trigger requirements: ${response.status} ${errorText}`);
  }

  const data: any = await response.json();

  return {
    triggerEventType: data.trigger_event_type,
    triggerHttpConfig: data.trigger_http_config,
    triggerInputSchema: data.trigger_input_schema,
  };
}

/**
 * Launch a workflow instance
 * Ported from: triggerWorkflow()
 */
export async function launchWorkflow(params: LaunchWorkflowParams): Promise<WorkflowInstanceResult> {
  const { connectionId, workflowId, instanceName, triggerInputs } = params;
  const { accessToken, accountId, apiBase } = await getValidAccessToken(connectionId);

  logInfo('Launching Maestro workflow', { workflowId, instanceName });

  const url = `${apiBase}/v1/accounts/${accountId}/workflows/${workflowId}/actions/trigger`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      instance_name: instanceName,
      trigger_inputs: triggerInputs,
    }),
    signal: AbortSignal.timeout(MAESTRO_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logError('Workflow launch failed', { status: response.status, error: errorText, workflowId });
    throw new Error(`Failed to launch workflow: ${response.status} ${errorText}`);
  }

  const result: any = await response.json();

  logInfo('Workflow launched successfully', { instanceId: result.instance_id });

  return {
    instanceId: result.instance_id,
    instanceUrl: result.instance_url,
  };
}

/**
 * Get workflow instances
 * Ported from: getWorkflowInstances()
 */
export async function getInstances(connectionId: string, workflowId: string): Promise<MaestroInstance[]> {
  const { accessToken, accountId, apiBase } = await getValidAccessToken(connectionId);

  const url = `${apiBase}/v1/accounts/${accountId}/workflows/${workflowId}/instances`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(MAESTRO_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get instances: ${response.status} ${errorText}`);
  }

  const data: any = await response.json();
  const instances = data.instances || data.data || [];

  const convertStatus = (s: string) => {
    if (!s) return 'unknown';
    const lower = s.toLowerCase().replace(/\s+/g, '_');
    // Normalize Maestro statuses to Baton statuses
    if (lower === 'in_progress') return 'running';
    if (lower === 'canceled') return 'cancelled';
    return lower;
  };

  return instances.map((inst: any) => ({
    id: inst.id,
    instanceName: inst.name || 'Unnamed Instance',
    workflowId: inst.workflow_id || workflowId,
    workflowName: inst.workflow_name,
    status: convertStatus(inst.workflow_status),
    lastStep: inst.last_completed_step_name || inst.last_completed_step,
    lastCompletedStep: inst.last_completed_step,
    lastCompletedStepName: inst.last_completed_step_name,
    totalSteps: inst.total_steps,
    startDate: inst.started_at,
    endDate: inst.ended_at || inst.canceled_at,
    instanceUrl: inst.instance_url || undefined,
    startedBy: inst.started_by,
    startedByName: inst.started_by_name,
  }));
}

/**
 * Get single workflow instance
 * Ported from: getWorkflowInstance()
 */
export async function getInstance(connectionId: string, workflowId: string, instanceId: string): Promise<MaestroInstance> {
  const { accessToken, accountId, apiBase } = await getValidAccessToken(connectionId);

  const url = `${apiBase}/v1/accounts/${accountId}/workflows/${workflowId}/instances/${instanceId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(MAESTRO_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get instance: ${response.status} ${errorText}`);
  }

  const inst: any = await response.json();
  const convertStatus = (s: string) => {
    if (!s) return 'unknown';
    const lower = s.toLowerCase().replace(/\s+/g, '_');
    if (lower === 'in_progress') return 'running';
    if (lower === 'canceled') return 'cancelled';
    return lower;
  };

  return {
    id: inst.id,
    instanceName: inst.name || 'Unnamed Instance',
    workflowId: inst.workflow_id || workflowId,
    workflowName: inst.workflow_name,
    status: convertStatus(inst.workflow_status),
    lastStep: inst.last_completed_step_name || inst.last_completed_step,
    lastCompletedStep: inst.last_completed_step,
    lastCompletedStepName: inst.last_completed_step_name,
    totalSteps: inst.total_steps,
    startDate: inst.started_at,
    endDate: inst.ended_at || inst.canceled_at,
    instanceUrl: inst.instance_url || undefined,
    startedBy: inst.started_by,
    startedByName: inst.started_by_name,
  };
}

/**
 * Cancel a workflow instance
 * Ported from: cancelWorkflowInstance()
 */
export async function cancelInstance(connectionId: string, workflowId: string, instanceId: string): Promise<void> {
  const { accessToken, accountId, apiBase } = await getValidAccessToken(connectionId);

  logInfo('Cancelling workflow instance', { workflowId, instanceId });

  const url = `${apiBase}/v1/accounts/${accountId}/workflows/${workflowId}/instances/${instanceId}/actions/cancel`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(MAESTRO_TIMEOUT_MS),
  });

  if (response.status === 409) {
    logInfo('Workflow instance already in terminal state, skipping cancel', { instanceId });
    return;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to cancel instance: ${response.status} ${errorText}`);
  }

  logInfo('Workflow instance cancelled', { instanceId });
}

export const _testExports = { getValidAccessToken };
