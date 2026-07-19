import { registry } from './registry';

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'Clerk session JWT. Obtain via Clerk frontend SDK and send as `Authorization: Bearer <token>`. ' +
    'Cookie fallback: the `__session` cookie set by Clerk is also accepted.',
});

registry.registerComponent('securitySchemes', 'devBypass', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Dev-UserId',
  description:
    'Development-only auth bypass. Requires `NODE_ENV=development`. ' +
    'Pair with `X-Dev-OrgId` and optionally `X-Dev-Role` (owner/admin/member/viewer/superuser).',
});

// Reusable header parameter — referenced from operations that support org switching.
// Most endpoints already resolve `orgId` from the Clerk JWT; this header overrides it
// for users who belong to multiple orgs (see POST /api/auth/switch-org).
registry.registerComponent('parameters', 'XClerkOrgId', {
  name: 'X-Clerk-Org-Id',
  in: 'header',
  required: false,
  description: 'Optional override for the active organization (must be a member).',
  schema: { type: 'string' },
});
