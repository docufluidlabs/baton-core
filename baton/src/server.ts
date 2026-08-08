import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import { logger } from './lib/logger';
import env from './env';

// Routes
import authRoutes from './routes/auth';
import localAuthRoutes from './routes/local-auth';
import connectionRoutes from './routes/connections';
import workflowRoutes from './routes/workflows';
import instanceRoutes from './routes/instances';
import ruleRoutes from './routes/rules';
import eventRoutes from './routes/events';
import automationRoutes from './routes/automations';
import dashboardRoutes from './routes/dashboard';
import notificationRoutes from './routes/notifications';
import userActivityRoutes from './routes/user-activity';
import settingsRoutes from './routes/settings';
import appRoutes from './routes/apps';
import publicCatalogRoutes from './routes/public-catalog';
import webhookEndpointRoutes from './routes/webhook-endpoints';
import flowLayoutRoutes from './routes/flow-layout';

// Webhook routes (no auth)
import salesforceWebhookRoutes from './routes/webhooks/salesforce';
import hubspotWebhookRoutes from './routes/webhooks/hubspot';
import zohocrmWebhookRoutes from './routes/webhooks/zohocrm';
import bamboohrWebhookRoutes from './routes/webhooks/bamboohr';
import smartsheetWebhookRoutes from './routes/webhooks/smartsheet';
import batchProcessorRoutes from './routes/batch-processors';
import docusignWebhookRoutes from './routes/webhooks/docusign';
import appWebhookRoutes from './routes/webhooks/app';
import ruleWebhookRoutes from './routes/webhooks/rule';
import postwebhookRoutes from './routes/webhooks/postwebhook';
import sfRegistrationRoutes from './routes/sf-registration';
import sfBootstrapTokensRoutes from './routes/sf-bootstrap-tokens';
import sfRotateSecretRoutes from './routes/sf-rotate-secret';
import { slackEventsRouter, slackConfigRouter, slackOAuthCallbackRouter, slackInstallRouter } from './routes/slack';

// Middleware
import { errorHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limit';
import { orgRateLimiter } from './middleware/org-rate-limit';
import { requireAuth } from './middleware/auth';
import { requestLogger } from './middleware/request-logger';

// SQS Workers
import { startAllWorkers, stopAllWorkers } from './workers';
import { ensureAllQueuesExist } from './queue/sqs-client';
import { ensureAllTablesExist } from './db/ensure-tables';
import { seedOwnerFromEnv } from './services/seed-owner';

// Scheduled Jobs
import { startScheduledJobs } from './lib/scheduler';

const app = express();

// Trust first proxy (ngrok / reverse proxy) so X-Forwarded-For is used for
// client IP detection.  This must be set before any middleware that reads the
// client IP (e.g. express-rate-limit), otherwise express-rate-limit v7+ throws:
//   ValidationError: The 'X-Forwarded-For' header is set but the Express
//   'trust proxy' setting is false (default).
app.set('trust proxy', 1);

// ─── Global Middleware ───────────────────────────────────────
// CSP setup (#28):
// - Development: CSP disabled entirely so Vite HMR and React DevTools inline
//   scripts are not blocked (they don't carry nonce attributes).
// - Production: nonce-based CSP.
if (env.NODE_ENV === 'production') {
  app.use((_req, res, next) => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          (_req: any, res: any) => `'nonce-${res.locals.cspNonce}'`,
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  }));
} else {
  // Development: CSP off — Vite injects inline scripts without nonce
  app.use(helmet({
    contentSecurityPolicy: false,
  }));
}
app.use(cors({
  origin: [
    env.FRONTEND_URL,
    env.APP_URL,
    'http://localhost:3002',
    'http://localhost:3001',
  ],
  credentials: true,
}));
app.use(requestLogger);
app.use(rateLimiter);

// Raw body for webhook signature verification (including Slack events)
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '5mb' }));
app.use('/api/postwebhook', express.raw({ type: 'application/json', limit: '5mb' }));
app.use('/api/slack/events', express.raw({ type: 'application/json', limit: '1mb' }));

// JSON body for all other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'baton-api', timestamp: new Date().toISOString() });
});
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'baton-api', timestamp: new Date().toISOString() });
});

// ─── Webhook Routes (no session auth, signature verification only) ──
app.use('/api/webhooks/salesforce', salesforceWebhookRoutes);
app.use('/api/webhooks/hubspot', hubspotWebhookRoutes);
app.use('/api/webhooks/zohocrm', zohocrmWebhookRoutes);
app.use('/api/webhooks/bamboohr', bamboohrWebhookRoutes);
app.use('/api/webhooks/smartsheet', smartsheetWebhookRoutes);
app.use('/api/webhooks/docusign', docusignWebhookRoutes);
app.use('/api/webhooks/app', appWebhookRoutes);
app.use('/api/webhooks/rule', ruleWebhookRoutes);
app.use('/api/postwebhook', postwebhookRoutes);

// ─── Salesforce Managed Package — bootstrap registration (no auth) ──
// Called by SF Apex on first webhook dispatch to exchange a bootstrap
// token for a persisted HMAC secret. Public by design (token IS the auth).
app.use('/api/salesforce/webhook-registrations', sfRegistrationRoutes);

// ─── Client Error Reporting (no auth — frontend may not have a session) ──
import errorReportRoutes from './routes/errors';
app.use('/api/errors', errorReportRoutes);

// ─── Local Auth (public: setup/login/logout/accept-invite) ──────────
// Mounted BEFORE the requireAuth apiRouter. Paths it does not handle
// (e.g. GET /api/auth/me) fall through to the authenticated /api router.
app.use('/api/auth', localAuthRoutes);

// ─── OAuth Callbacks (no session auth — called by external providers) ──
app.use('/api/connections', connectionRoutes);

// ─── API Routes (session auth required) ──────────────────────
// Per-IP rate limiting applied after auth for all authenticated routes
const apiRouter = express.Router();
apiRouter.use(requireAuth);
apiRouter.use(orgRateLimiter);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/workflows', workflowRoutes);
apiRouter.use('/instances', instanceRoutes);
apiRouter.use('/automations', ruleRoutes);
apiRouter.use('/events', eventRoutes);
apiRouter.use('/automations', automationRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/my', userActivityRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/platforms', appRoutes);
apiRouter.use('/webhook-endpoints', webhookEndpointRoutes);
apiRouter.use('/slack', slackConfigRouter);
apiRouter.use('/flow-layout', flowLayoutRoutes);
apiRouter.use('/batch-processors', batchProcessorRoutes);
apiRouter.use('/salesforce/bootstrap-tokens', sfBootstrapTokensRoutes);
apiRouter.use('/salesforce/rotate-secret', sfRotateSecretRoutes);

// ─── Slack public routes under /api (before apiRouter to bypass requireAuth) ─
app.use('/api/slack/install', slackInstallRouter);
app.use('/api/slack/events', slackEventsRouter);
app.use('/api/slack/oauth/callback', slackOAuthCallbackRouter);

// ─── Public platform catalog (before apiRouter to bypass requireAuth) ─
// Powers the publicly-readable documentation setup guides at /docs/setup/*.
app.use('/api/public/platforms-catalog', publicCatalogRoutes);

// ─── OpenAPI / Swagger UI (basic-auth gated) ─────────────────
// Mounted BEFORE `app.use('/api', apiRouter)` so /api/docs* takes precedence
// over apiRouter (which would otherwise require a session). The /api
// prefix matches the existing ALB ingress rule, so no extra ingress entries
// are needed. Both BATON_DOCS_USER and BATON_DOCS_PASS must be set to enable.
if (env.BATON_DOCS_USER && env.BATON_DOCS_PASS) {
  // Lazy-require so swagger-ui-express assets don't load when docs are off
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const swaggerUi = require('swagger-ui-express');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const basicAuth = require('express-basic-auth');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildOpenApiDocument } = require('./docs');
  const spec = buildOpenApiDocument();

  const docsAuth = basicAuth({
    users: { [env.BATON_DOCS_USER]: env.BATON_DOCS_PASS },
    challenge: true,
    realm: 'Baton API Docs',
  });

  app.get('/api/docs.json', docsAuth, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(spec);
  });

  // Hide the Try-It-Out button for inbound-webhook operations — they require
  // provider-signed raw bodies and are documented for reference only.
  // Swagger UI 5 renders each tag's section as `<section class="opblock-tag-section" data-tag="…">`.
  const readOnlyTagCss = `
    .opblock-tag-section[data-tag="Inbound Webhooks"] .try-out { display: none !important; }
    .opblock-tag-section[data-tag="Inbound Webhooks"] .opblock-summary { cursor: default; }
    .opblock-tag-section[data-tag="Inbound Webhooks"] .opblock-tag-section-header::after {
      content: " · reference only (Try-It-Out disabled)";
      color: #888;
      font-size: 12px;
      font-weight: normal;
    }
  `;

  app.use(
    '/api/docs',
    docsAuth,
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      explorer: true,
      customCss: readOnlyTagCss,
      swaggerOptions: {
        persistAuthorization: true,
        tryItOutEnabled: true,
        url: '/api/docs.json',
      },
    }),
  );

  logger.info(`📖 OpenAPI docs at /api/docs (basic-auth, user: ${env.BATON_DOCS_USER})`);
} else {
  logger.info('📖 OpenAPI docs disabled — set BATON_DOCS_USER and BATON_DOCS_PASS to enable');
}

app.use('/api', apiRouter);

app.use(errorHandler);

// ─── Serve Frontend ──────────────────────────────────────────
const frontendDir = path.resolve(__dirname, '../../baton-front/dist');

if (env.NODE_ENV === 'development') {
  // Dev mode: proxy all non-API requests to Vite dev server (hot-reload)
  const { createProxyMiddleware } = require('http-proxy-middleware');
  app.use(
    '/',
    createProxyMiddleware({
      target: 'http://localhost:3002',
      changeOrigin: true,
      ws: true, // WebSocket for Vite HMR
      logLevel: 'warn',
    }),
  );
  logger.info('🔄 Proxying frontend to Vite dev server at http://localhost:3002');
} else if (fs.existsSync(frontendDir)) {
  // Production: serve built static files
  app.use('/assets', express.static(path.join(frontendDir, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(frontendDir, { maxAge: 0, index: false }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
  logger.info(`📁 Serving frontend from ${frontendDir}`);
}

// ─── Start Server ────────────────────────────────────────────
const PORT = env.PORT;

const server = app.listen(PORT, () => {
  logger.info(`🚀 Baton API running on port ${PORT}`);
  logger.info(`📡 Public URL: ${env.APP_URL}`);
  logger.info(`🌍 Environment: ${env.NODE_ENV}`);

  // Ensure DynamoDB tables and SQS queues exist before starting workers
  // (idempotent — safe on every boot; on LocalStack missing ones are created,
  // on real AWS they must pre-exist via CloudFormation), then seed the owner
  // account from env if configured.
  ensureAllTablesExist()
    .then(() => ensureAllQueuesExist())
    .then(() => seedOwnerFromEnv())
    .then(() => startAllWorkers())
    .catch((err) => {
      logger.error({ err }, 'Failed to initialize tables/queues or start workers');
    });

  // Start scheduled cron jobs only on the designated pod (#10)
  // Set SCHEDULER_ENABLED=false on extra pods to prevent N-pod duplicate cron runs.
  if (env.SCHEDULER_ENABLED) {
    startScheduledJobs();
  } else {
    logger.info('Scheduler disabled on this pod (SCHEDULER_ENABLED=false)');
  }
});

// ─── Graceful Shutdown ──────────────────────────────────────
function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully...`);
  stopAllWorkers();
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  // Force exit after 3s if graceful shutdown hangs
  setTimeout(() => {
    logger.warn('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 3_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal(
    { err: reason instanceof Error ? reason : new Error(String(reason)) },
    'Unhandled promise rejection — shutting down',
  );
  process.exit(1);
});

export default app;
