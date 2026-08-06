/**
 * Instance Service — Baton
 *
 * Shared workflow-instance operations used by both the instance routes and the
 * Bulk Upload (batch) routes. The cancel logic mirrors
 * routes/instances.ts POST /:id/cancel so batch run/row cancel can reuse it
 * without duplicating the Workflow Builder connection-resolution code.
 */
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../db/client';
import { logInfo } from '../lib/logger';
import { WorkflowInstance } from '../lib/types';
import * as maestroService from './maestro.service';
import * as connectionService from './connection.service';

/**
 * Cancel a workflow instance: best-effort cancel in Workflow Builder (when the
 * instance has a Workflow Builder id and a usable DocuSign connection can be
 * resolved), then mark the local record cancelled. A Workflow Builder 4xx on
 * already-terminal instances is swallowed — the user's intent is still
 * recorded locally.
 */
export async function cancelWorkflowInstance(instance: WorkflowInstance): Promise<void> {
  const docClient = getDocClient();

  if (instance.maestroInstanceId) {
    const workflow = await docClient.send(new GetCommand({
      TableName: TableNames.WORKFLOWS,
      Key: { id: instance.workflowId },
    }));

    const wf = workflow.Item;
    if (wf?.maestroWorkflowId) {
      // Resolve a valid DocuSign connection
      let dsConnId = wf.connectionId;
      if (dsConnId) {
        const conn = await connectionService.getConnection(dsConnId);
        if (!conn || conn.platform !== 'docusign') dsConnId = undefined;
      }
      if (!dsConnId) {
        const orgConns = await connectionService.getConnectionsByOrg(instance.orgId);
        dsConnId = orgConns.find((c: any) => c.platform === 'docusign' && c.status === 'healthy')?.id;
      }
      if (dsConnId) {
        // Workflow Builder returns 4xx if the instance is already terminal —
        // that's fine, we still want to record the manual cancel locally so
        // the user's intent is reflected in the UI.
        try {
          await maestroService.cancelInstance(dsConnId, wf.maestroWorkflowId, instance.maestroInstanceId);
        } catch (err) {
          logInfo('Workflow Builder cancel rejected - proceeding with local cancel', {
            instanceId: instance.id,
            error: (err as Error)?.message,
          });
        }
      }
    }
  }

  // Update local status
  const nowIso = new Date().toISOString();
  await docClient.send(new UpdateCommand({
    TableName: TableNames.WORKFLOW_INSTANCES,
    Key: { id: instance.id },
    UpdateExpression: 'SET #st = :status, completedAt = :now, manuallyCancelledAt = :now',
    ExpressionAttributeValues: { ':status': 'cancelled', ':now': nowIso },
    ExpressionAttributeNames: { '#st': 'status' },
  }));

  logInfo('Instance cancelled', { instanceId: instance.id });
}
