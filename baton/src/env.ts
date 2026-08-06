import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config();

const env = {
  // App
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3001', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || '',
  APP_URL: process.env.APP_URL || 'http://localhost:3001',
  API_URL: process.env.API_URL || 'http://localhost:3001',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3002',
  // Max authenticated API requests per minute, per client IP.
  RATE_LIMIT_PER_MINUTE: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '300', 10),

  // AWS General
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',

  // DynamoDB
  DYNAMODB_REGION: process.env.DYNAMODB_REGION || process.env.AWS_REGION || 'us-east-1',
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT || '',
  DYNAMODB_TABLE_PREFIX: process.env.DYNAMODB_TABLE_PREFIX || 'baton-',

  // SQS
  SQS_REGION: process.env.SQS_REGION || process.env.AWS_REGION || 'us-east-1',
  SQS_ENDPOINT: process.env.SQS_ENDPOINT || '',
  SQS_QUEUE_PREFIX: process.env.SQS_QUEUE_PREFIX || 'baton-',

  // Encryption
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY || '',

  // Local auth (self-contained email/password sessions)
  // Generate with: openssl rand -hex 32
  AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET || '',
  // Single-org install: every user belongs to this organization.
  BATON_ORG_ID: process.env.BATON_ORG_ID || 'default-org',

  // DocuSign
  DOCUSIGN_INTEGRATION_KEY: process.env.DOCUSIGN_INTEGRATION_KEY || '',
  DOCUSIGN_SECRET_KEY: process.env.DOCUSIGN_SECRET_KEY || '',
  DOCUSIGN_RSA_PRIVATE_KEY: process.env.DOCUSIGN_RSA_PRIVATE_KEY || '',
  DOCUSIGN_ACCOUNT_ID: process.env.DOCUSIGN_ACCOUNT_ID || '',
  DOCUSIGN_BASE_URL: process.env.DOCUSIGN_BASE_URL || '',
  DOCUSIGN_OAUTH_BASE: process.env.DOCUSIGN_OAUTH_BASE || 'https://account-d.docusign.com',
  DOCUSIGN_CONNECT_HMAC_KEY: process.env.DOCUSIGN_CONNECT_HMAC_KEY || '',
  DOCUSIGN_MAESTRO_API_BASE: process.env.DOCUSIGN_MAESTRO_API_BASE || 'https://api-d.docusign.com',

  // BambooHR
  BAMBOOHR_CLIENT_ID: process.env.BAMBOOHR_CLIENT_ID || '',
  BAMBOOHR_CLIENT_SECRET: process.env.BAMBOOHR_CLIENT_SECRET || '',
  BAMBOOHR_REDIRECT_URI: process.env.BAMBOOHR_REDIRECT_URI || '',
  BAMBOOHR_WEBHOOK_SECRET: process.env.BAMBOOHR_WEBHOOK_SECRET || '',

  // Smartsheet
  SMARTSHEET_CLIENT_ID: process.env.SMARTSHEET_CLIENT_ID || '',
  SMARTSHEET_CLIENT_SECRET: process.env.SMARTSHEET_CLIENT_SECRET || '',
  SMARTSHEET_REDIRECT_URI: process.env.SMARTSHEET_REDIRECT_URI || '',
  SMARTSHEET_WEBHOOK_SECRET: process.env.SMARTSHEET_WEBHOOK_SECRET || '',

  // Zoho CRM
  ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID || '',
  ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET || '',
  ZOHO_REDIRECT_URI: process.env.ZOHO_REDIRECT_URI || '',
  // Regional accounts server: .com (US), .eu, .in, .com.au, .com.cn, .jp
  ZOHO_ACCOUNTS_BASE: process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.com',

  // HubSpot (webhook-only — no OAuth)
  HUBSPOT_WEBHOOK_SECRET: process.env.HUBSPOT_WEBHOOK_SECRET || '',

  // Notifications
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || 'Baton <notifications@iambaton.com>',
  NOTIFICATION_FROM_EMAIL: process.env.NOTIFICATION_FROM_EMAIL || 'notifications@iambaton.com',

  // Slack OAuth App (distributed — each org installs via OAuth)
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || '',
  SLACK_DEFAULT_CHANNEL: process.env.SLACK_DEFAULT_CHANNEL || '#baton-alerts',
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID || '',
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET || '',
  SLACK_OAUTH_REDIRECT_URI: process.env.SLACK_OAUTH_REDIRECT_URI || '',

  // Scheduler — set SCHEDULER_ENABLED=false on extra pods to prevent duplicate cron execution (#10)
  SCHEDULER_ENABLED: process.env.SCHEDULER_ENABLED !== 'false',

  // API Docs — basic-auth credentials for /api/docs and /api/docs.json.
  // Both must be set to enable docs; otherwise the routes are not mounted.
  BATON_DOCS_USER: process.env.BATON_DOCS_USER || '',
  BATON_DOCS_PASS: process.env.BATON_DOCS_PASS || '',
};

// ─── Startup Validation (#09) ────────────────────────────────
// Fail fast in production if critical env vars are missing or obviously wrong.

const productionSchema = z.object({
  TOKEN_ENCRYPTION_KEY: z.string().min(32, 'TOKEN_ENCRYPTION_KEY must be at least 32 chars'),
  AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET must be at least 32 chars — generate with `openssl rand -hex 32`'),
  DOCUSIGN_INTEGRATION_KEY: z.string().optional(),
  DOCUSIGN_CONNECT_HMAC_KEY: z.string().optional(),
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL'),
});

if (env.NODE_ENV === 'production') {
  const result = productionSchema.safeParse(env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration — refusing to start:');
    console.error(JSON.stringify(result.error.flatten().fieldErrors, null, 2));
    process.exit(1);
  }
}

export default env;
