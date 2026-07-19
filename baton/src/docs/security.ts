import { registry } from './registry';

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Session JWT issued by POST /api/auth/login (or /setup, /accept-invite). ' +
    'Sent automatically as the httpOnly `baton_session` cookie — no header needed from browsers.',
});

registry.registerComponent('securitySchemes', 'devBypass', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Dev-UserId',
  description:
    'Development-only auth bypass. Requires `NODE_ENV=development`. ' +
    'Pair with `X-Dev-OrgId` and optionally `X-Dev-Role` (owner/admin/member/viewer/superuser).',
});

