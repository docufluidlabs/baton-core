import { registry } from '../registry';
import { commonErrorResponses } from '../components';
import {
  SfBootstrapTokenInput,
  SfBootstrapTokenResponse,
  SfRotateSecretInput,
  SfRotateSecretResponse,
} from '../schemas/salesforce';

const TAG = 'Salesforce';
const SECURITY = [{ bearerAuth: [] }];

registry.registerPath({
  method: 'post',
  path: '/api/salesforce/bootstrap-tokens',
  tags: [TAG],
  summary: 'Issue a one-time bootstrap token for a SF automation webhook',
  description:
    'Returns a `webhookUrl` that already contains `?bootstrap=<tokenId>`. ' +
    'Pasted into Salesforce Flow Builder, the URL lets the Apex managed package ' +
    'register its HMAC secret on first dispatch - no manual secret entry.',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: SfBootstrapTokenInput } } } },
  responses: {
    200: { description: 'Token issued', content: { 'application/json': { schema: SfBootstrapTokenResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    404: commonErrorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/salesforce/rotate-secret',
  tags: [TAG],
  summary: 'Force-rotate the HMAC secret for a SF webhook integration',
  description:
    'Clears every entry in `OrgApp.sfRegistrations` for the rule\'s app and ' +
    'issues a fresh bootstrap token. The next dispatch from any SF org will ' +
    '401, triggering the Apex auto-heal path. Affects all rules under this app.',
  security: SECURITY,
  request: { body: { content: { 'application/json': { schema: SfRotateSecretInput } } } },
  responses: {
    200: { description: 'Rotated', content: { 'application/json': { schema: SfRotateSecretResponse } } },
    400: commonErrorResponses[400],
    401: commonErrorResponses[401],
    403: commonErrorResponses[403],
    404: commonErrorResponses[404],
    409: commonErrorResponses[409],
  },
});
