import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import {
  WorkflowSchema,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  SyncWorkflowsInput,
  LaunchWorkflowInput,
} from '../schemas/workflow';
import { WorkflowInstanceSchema } from '../schemas/instance';
import { MessageResponse } from '../schemas/common';

const TAG = 'Workflows';
const SECURITY = [{ bearerAuth: [] }];
const idParam = z.object({ id: z.string().uuid().openapi({ description: 'Workflow UUID' }) });

registry.registerPath({
  method: 'get',
  path: '/api/workflows',
  tags: [TAG],
  summary: 'List workflows for current organization',
  description:
    'Returns all workflows for the requesting org. Also fires a non-blocking background ' +
    'Workflow Builder schema check (at most once every 5 minutes per org) so saved trigger schemas stay fresh.',
  security: SECURITY,
  responses: {
    200: {
      description: 'List of workflows',
      content: { 'application/json': { schema: z.object({ workflows: z.array(WorkflowSchema) }) } },
    },
    401: commonErrorResponses[401],
    500: commonErrorResponses[500],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/workflows/{id}',
  tags: [TAG],
  summary: 'Get workflow details',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Workflow',
      content: { 'application/json': { schema: z.object({ workflow: WorkflowSchema }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workflows',
  tags: [TAG],
  summary: 'Create a workflow manually',
  description: 'Requires admin role. Use this for workflows not yet bound to a Workflow Builder workflow id.',
  security: SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateWorkflowInput } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: z.object({ workflow: WorkflowSchema }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/workflows/{id}',
  tags: [TAG],
  summary: 'Update workflow fields',
  description: 'Requires admin role. All fields are optional; only provided fields are updated.',
  security: SECURITY,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: UpdateWorkflowInput } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: MessageResponse } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workflows/sync',
  tags: [TAG],
  summary: 'Sync all workflows from Docusign Workflow Builder',
  description:
    'Requires admin role. Pulls all workflows from Workflow Builder into the org, creating/updating ' +
    'local records and deleting orphans no longer present in Workflow Builder.',
  security: SECURITY,
  request: {
    body: { content: { 'application/json': { schema: SyncWorkflowsInput } } },
  },
  responses: {
    200: {
      description: 'Sync complete',
      content: {
        'application/json': {
          schema: z.object({
            workflows: z.array(WorkflowSchema),
            syncedCount: z.number().int(),
          }),
        },
      },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workflows/{id}/sync',
  tags: [TAG],
  summary: 'Sync a single workflow\'s trigger schema from Workflow Builder',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Sync complete',
      content: {
        'application/json': {
          schema: z.object({
            message: z.string(),
            triggerInputSchema: z.record(z.any()).optional(),
            triggerType: z.string().optional(),
          }),
        },
      },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/workflows/{id}/launch',
  tags: [TAG],
  summary: 'Launch a workflow manually',
  description: 'Requires member role. Creates a new Workflow Builder instance and a matching local instance record.',
  security: SECURITY,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: LaunchWorkflowInput } } },
  },
  responses: {
    201: {
      description: 'Launched',
      content: { 'application/json': { schema: z.object({ instance: WorkflowInstanceSchema }) } },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/workflows/{id}/instances',
  tags: [TAG],
  summary: 'List instances for a workflow',
  description:
    'Returns up to 50 most recent instances. When `live=true`, statuses are enriched from Workflow Builder and ' +
    'persisted back to local state when a terminal status (completed/failed/cancelled) is observed.',
  security: SECURITY,
  request: {
    params: idParam,
    query: z.object({
      live: z.enum(['true', 'false']).optional().openapi({
        description: 'When `true`, enriches instances with live Workflow Builder state.',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Instances list',
      content: { 'application/json': { schema: z.object({ instances: z.array(WorkflowInstanceSchema) }) } },
    },
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/workflows/{id}',
  tags: [TAG],
  summary: 'Delete a workflow',
  description: 'Requires admin role. Only the local record is removed; Workflow Builder state is untouched.',
  security: SECURITY,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Deleted',
      content: { 'application/json': { schema: MessageResponse } },
    },
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
  },
});
