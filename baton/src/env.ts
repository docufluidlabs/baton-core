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

  // Clerk
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY || '',
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY || '',
  CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET || '',

  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  // Metered billing — Price IDs for Starter + Growth (base + metered overage).
  // Each plan = 1 Stripe Product with 2 prices: a licensed flat base and a
  // graduated tiered metered price. Populate after creating products in Stripe.
  STRIPE_PRICE_STARTER_BASE: process.env.STRIPE_PRICE_STARTER_BASE || '',
  STRIPE_PRICE_STARTER_OVERAGE: process.env.STRIPE_PRICE_STARTER_OVERAGE || '',
  STRIPE_PRICE_GROWTH_BASE: process.env.STRIPE_PRICE_GROWTH_BASE || '',
  STRIPE_PRICE_GROWTH_OVERAGE: process.env.STRIPE_PRICE_GROWTH_OVERAGE || '',
  STRIPE_METER_ID: process.env.STRIPE_METER_ID || '',
  STRIPE_METER_RELAY_EVENT_NAME: process.env.STRIPE_METER_RELAY_EVENT_NAME || 'relay.routed',
  STRIPE_GROWTH_OVERAGE_RATE_CENTS: parseInt(process.env.STRIPE_GROWTH_OVERAGE_RATE_CENTS || '12', 10),

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

  // Zoho CRM
  ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID || '',
  ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET || '',
  ZOHO_REDIRECT_URI: process.env.ZOHO_REDIRECT_URI || '',

  // HubSpot (webhook-only — no OAuth)
  HUBSPOT_WEBHOOK_SECRET: process.env.HUBSPOT_WEBHOOK_SECRET || '',

  // S3
  S3_ENDPOINT: process.env.S3_ENDPOINT || '',
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY || '',
  S3_SECRET_KEY: process.env.S3_SECRET_KEY || '',

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
  CLERK_SECRET_KEY: z.string().startsWith('sk_', 'CLERK_SECRET_KEY must start with sk_'),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
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
