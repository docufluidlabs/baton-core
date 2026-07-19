import { z } from 'zod';
import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import { SlackChannelRouting, SlackConfigInput } from '../schemas/slack';
import { MessageResponse } from '../schemas/common';

const TAG = 'Slack';
const SECURITY = [{ bearerAuth: [] }];

registry.registerPath({
  method: 'get',
  path: '/api/slack/oauth/install',
  tags: [TAG],
  summary: 'Get the Slack OAuth authorization URL',
  description: 'Frontend navigates to the returned URL to begin the Slack OAuth flow.',
  security: SECURITY,
  responses: {
    200: { description: 'URL', content: { 'application/json': { schema: z.object({ url: z.string().url() }) } } },
    401: commonErrorResponses[401],
    500: commonErrorResponses[500],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/slack/config',
  tags: [TAG],
  summary: 'Get Slack configuration for the org',
  security: SECURITY,
  responses: {
    200: {
      description: 'Config',
      content: {
        'application/json': {
          schema: z.object({
            config: z.object({
              orgId: z.string(),
              enabled: z.boolean(),
              channelRouting: SlackChannelRouting,
            }),
            connected: z.boolean(),
            teamName: z.string().optional(),
            teamId: z.string().optional(),
          }),
        },
      },
    },
    401: commonErrorResponses[401],
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/slack/config',
  tags: [TAG],
  summary: 'Save Slack channel routing + enabled state',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: SlackConfigInput } } } },
  responses: {
    200: { description: 'Saved', content: { 'application/json': { schema: MessageResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/slack/config',
  tags: [TAG],
  summary: 'Disconnect the Slack workspace',
  security: SECURITY,
  responses: {
    200: { description: 'Disconnected', content: { 'application/json': { schema: MessageResponse } } },
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/slack/channels',
  tags: [TAG],
  summary: 'List channels the Slack bot can post to',
  security: SECURITY,
  responses: {
    200: {
      description: 'Channels',
      content: {
        'application/json': {
          schema: z.object({
            channels: z.array(z.object({
              id: z.string(),
              name: z.string(),
              is_private: z.boolean(),
              num_members: z.number().int(),
            })),
          }),
        },
      },
    },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/slack/test',
  tags: [TAG],
  summary: 'Send a test message to the configured Slack channel',
  security: SECURITY,
  responses: {
    200: { description: 'Sent', content: { 'application/json': { schema: MessageResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
  },
});
