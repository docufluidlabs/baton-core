/**
 * Clerk Webhook Route — Baton
 * POST /api/webhooks/clerk
 * 
 * Receives user/org events from Clerk for syncing to DynamoDB.
 * Uses Svix signature verification (Clerk's webhook delivery system).
 */
import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, TableNames } from '../../db/client';
import { logInfo, logError, logWarn } from '../../lib/logger';
import { PLAN_INFO } from '../../services/stripe.service';
import env from '../../env';

const router = Router();

/**
 * Verify Clerk/Svix webhook signature
 */
function verifyClerkSignature(rawBody: Buffer, headers: Record<string, any>, secret: string): boolean {
  try {
    const svixId = headers['svix-id'];
    const svixTimestamp = headers['svix-timestamp'];
    const svixSignature = headers['svix-signature'];

    if (!svixId || !svixTimestamp || !svixSignature) return false;

    // Decode the webhook secret (remove "whsec_" prefix if present)
    const secretBytes = Buffer.from(
      secret.startsWith('whsec_') ? secret.slice(6) : secret,
      'base64'
    );

    const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString('utf8')}`;
    const computedSignature = crypto
      .createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');

    // Svix may send multiple signatures separated by space
    const expectedSigs = svixSignature.split(' ').map((s: string) => s.replace('v1,', ''));

    return expectedSigs.some((sig: string) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computedSignature));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const rawBody = req.body as Buffer;
    const headers = req.headers;

    // Verify signature
    if (!verifyClerkSignature(rawBody, headers, env.CLERK_WEBHOOK_SECRET)) {
      logWarn('Clerk webhook signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventType = payload.type;
    const data = payload.data;

    logInfo('Clerk webhook received', { eventType, id: data?.id });

    const docClient = getDocClient();
    const now = new Date().toISOString();

    switch (eventType) {
      case 'user.created':
      case 'user.updated': {
        // Sync user to baton-users table
        const email = data.email_addresses?.[0]?.email_address || '';
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ');

        // Find or create user
        const existing = await docClient.send(new QueryCommand({
          TableName: TableNames.USERS,
          IndexName: 'clerkUserId-index',
          KeyConditionExpression: 'clerkUserId = :clerkUserId',
          ExpressionAttributeValues: { ':clerkUserId': data.id },
        }));

        if (existing.Items && existing.Items.length > 0) {
          // Update existing
          await docClient.send(new UpdateCommand({
            TableName: TableNames.USERS,
            Key: { id: existing.Items[0].id },
            UpdateExpression: 'SET email = :email, fullName = :fullName, updatedAt = :updatedAt',
            ExpressionAttributeValues: { ':email': email, ':fullName': fullName, ':updatedAt': now },
          }));
        } else {
          // Create new user
          await docClient.send(new PutCommand({
            TableName: TableNames.USERS,
            Item: {
              id: uuidv4(),
              clerkUserId: data.id,
              orgId: '', // Will be set when user joins an org
              email,
              fullName,
              role: 'member',
              createdAt: now,
              updatedAt: now,
            },
          }));
        }
        break;
      }

      case 'organization.created':
      case 'organization.updated': {
        // Sync org
        const existingOrg = await docClient.send(new QueryCommand({
          TableName: TableNames.ORGANIZATIONS,
          IndexName: 'clerkOrgId-index',
          KeyConditionExpression: 'clerkOrgId = :clerkOrgId',
          ExpressionAttributeValues: { ':clerkOrgId': data.id },
        }));

        if (existingOrg.Items && existingOrg.Items.length > 0) {
          await docClient.send(new UpdateCommand({
            TableName: TableNames.ORGANIZATIONS,
            Key: { id: existingOrg.Items[0].id },
            UpdateExpression: 'SET #n = :name, slug = :slug, updatedAt = :updatedAt',
            ExpressionAttributeValues: { ':name': data.name, ':slug': data.slug, ':updatedAt': now },
            ExpressionAttributeNames: { '#n': 'name' },
          }));
        } else {
          // New org: start on free_demo with a 14-day trial. Stripe Customer
          // is created lazily on first checkout — none of the meter/billing
          // fields point at Stripe yet. The relay gate respects trialEndsAt.
          const trialDays = PLAN_INFO.free_demo.trialDays;
          const trialEndsAt = new Date(Date.now() + trialDays * 86_400_000).toISOString();
          await docClient.send(new PutCommand({
            TableName: TableNames.ORGANIZATIONS,
            Item: {
              id: uuidv4(),
              clerkOrgId: data.id,
              name: data.name,
              slug: data.slug || data.name.toLowerCase().replace(/\s+/g, '-'),
              plan: 'free_demo',
              subscriptionStatus: 'trialing',
              trialEndsAt,
              includedRelays: null,           // unlimited during trial
              overageEnabled: false,
              overageRateCents: 0,
              exemptFromMeter: false,        // not exempt — emits start once Stripe customer exists
              billingCycleStart: now,
              executionsUsed: 0,
              createdAt: now,
              updatedAt: now,
            },
          }));
        }
        break;
      }

      case 'organizationMembership.created': {
        // Link user to org
        const userId = data.public_user_data?.user_id;
        const orgClerkId = data.organization?.id;
        const role = data.role === 'admin' ? 'admin' : 'member';

        if (userId) {
          const userResult = await docClient.send(new QueryCommand({
            TableName: TableNames.USERS,
            IndexName: 'clerkUserId-index',
            KeyConditionExpression: 'clerkUserId = :clerkUserId',
            ExpressionAttributeValues: { ':clerkUserId': userId },
          }));

          const orgResult = await docClient.send(new QueryCommand({
            TableName: TableNames.ORGANIZATIONS,
            IndexName: 'clerkOrgId-index',
            KeyConditionExpression: 'clerkOrgId = :clerkOrgId',
            ExpressionAttributeValues: { ':clerkOrgId': orgClerkId },
          }));

          if (userResult.Items?.[0] && orgResult.Items?.[0]) {
            await docClient.send(new UpdateCommand({
              TableName: TableNames.USERS,
              Key: { id: userResult.Items[0].id },
              UpdateExpression: 'SET orgId = :orgId, #r = :role, updatedAt = :updatedAt',
              ExpressionAttributeValues: {
                ':orgId': orgResult.Items[0].id,
                ':role': role,
                ':updatedAt': now,
              },
              ExpressionAttributeNames: { '#r': 'role' },
            }));
          }
        }
        break;
      }

      default:
        logInfo('Unhandled Clerk event type', { eventType });
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    logError('Clerk webhook handler error', error);
    res.status(200).json({ received: true }); // Don't retry
  }
});

export const _testExports = { verifyClerkSignature };

export default router;
