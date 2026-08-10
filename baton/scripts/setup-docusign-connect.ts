/**
 * Setup Docusign Connect configuration via API
 *
 * Usage: npx tsx scripts/setup-docusign-connect.ts
 *
 * Requires a valid Docusign connection in DynamoDB with a non-expired access token.
 */

import 'dotenv/config';
import { getDocClient, TableNames } from '../src/db/client';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { decryptToken } from '../src/lib/encryption';

const DOCUSIGN_BASE_URL = process.env.DOCUSIGN_BASE_URL || 'https://demo.docusign.net/restapi';
const DOCUSIGN_ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID || '';
const WEBHOOK_URL = `${process.env.API_URL}/api/webhooks/docusign`;

async function getDocuSignAccessToken(): Promise<string> {
  const docClient = getDocClient();
  const result = await docClient.send(new QueryCommand({
    TableName: TableNames.PLATFORM_CONNECTIONS,
    IndexName: 'GSI-accountId',
    KeyConditionExpression: 'accountId = :accountId',
    ExpressionAttributeValues: { ':accountId': DOCUSIGN_ACCOUNT_ID },
  }));

  const connection = result.Items?.[0];
  if (!connection) {
    throw new Error(`No Docusign connection found for accountId: ${DOCUSIGN_ACCOUNT_ID}`);
  }

  return decryptToken(connection.accessTokenEnc as string);
}

async function listConnectConfigurations(accessToken: string) {
  const url = `${DOCUSIGN_BASE_URL}/v2.1/accounts/${DOCUSIGN_ACCOUNT_ID}/connect`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list Connect configs: ${res.status} ${text}`);
  }

  return res.json();
}

async function createConnectConfiguration(accessToken: string) {
  const url = `${DOCUSIGN_BASE_URL}/v2.1/accounts/${DOCUSIGN_ACCOUNT_ID}/connect`;

  const config = {
    name: 'Baton Webhooks',
    urlToPublishTo: WEBHOOK_URL,
    allUsers: 'true',
    allUsersExcept: '',
    configurationType: 'custom',
    deliveryMode: 'SIM',
    enableLog: 'true',
    requiresAcknowledgement: 'true',
    eventData: {
      version: 'restv2.1',
      format: 'json',
      includeData: ['recipients'],
    },
    events: [
      'envelope-sent',
      'envelope-delivered',
      'envelope-completed',
      'envelope-declined',
      'envelope-voided',
      'recipient-sent',
      'recipient-completed',
      'recipient-declined',
    ],
  };

  console.log('\nCreating Connect configuration:');
  console.log(`  URL: ${WEBHOOK_URL}`);
  console.log(`  Events: ${config.events.join(', ')}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create Connect config: ${res.status} ${text}`);
  }

  return res.json();
}

async function main() {
  console.log('=== Docusign Connect Setup ===\n');
  console.log(`Account ID: ${DOCUSIGN_ACCOUNT_ID}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
  console.log(`API Base: ${DOCUSIGN_BASE_URL}`);

  // Get access token from DynamoDB
  console.log('\nFetching access token from DynamoDB...');
  const accessToken = await getDocuSignAccessToken();
  console.log('Access token retrieved.');

  // List existing configurations
  console.log('\nChecking existing Connect configurations...');
  const existing = await listConnectConfigurations(accessToken);
  const configs = existing.configurations || [];
  console.log(`Found ${configs.length} existing configuration(s)`);

  for (const cfg of configs) {
    console.log(`  - [${cfg.connectId}] ${cfg.name}: ${cfg.urlToPublishTo}`);
  }

  // Check if our URL is already configured
  const alreadyExists = configs.some(
    (cfg: any) => cfg.urlToPublishTo === WEBHOOK_URL
  );

  if (alreadyExists) {
    console.log('\nConnect configuration already exists for this URL. Done.');
    return;
  }

  // Create new configuration
  const created = await createConnectConfiguration(accessToken);
  console.log(`\nConnect configuration created successfully!`);
  console.log(`  Connect ID: ${created.connectId}`);
  console.log(`  Name: ${created.name}`);
  console.log(`  URL: ${created.urlToPublishTo}`);

  console.log('\n=== IMPORTANT ===');
  console.log('Now set your HMAC key in the Docusign Admin UI:');
  console.log('  Settings → Connect → Connect Keys tab');
  console.log('  Copy the key and set it in .env as DOCUSIGN_CONNECT_HMAC_KEY');
  console.log('\nOr if the UI is broken, the webhook will still work without HMAC');
  console.log('(signature verification will be skipped if DOCUSIGN_CONNECT_HMAC_KEY is empty)');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
