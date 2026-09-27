/**
 * Body parsing - Baton
 *
 * One place for the parsers and the order they are mounted in, because the
 * order is what webhook verification depends on: a signature covers the exact
 * bytes a platform sent, so the webhook routes must receive those bytes before
 * any parser turns them into an object.
 */
import express, { Express } from 'express';

const anyContentType = () => true;

export function mountBodyParsers(app: Express): void {
  // The webhook routes keep EVERY content type raw, form posts (Zoho's
  // default) included: their handlers verify and parse the bytes themselves.
  app.use('/api/webhooks', express.raw({ type: anyContentType, limit: '5mb' }));
  app.use('/api/postwebhook', express.raw({ type: anyContentType, limit: '5mb' }));
  // Slack's Events API posts JSON only.
  app.use('/api/slack/events', express.raw({ type: 'application/json', limit: '1mb' }));

  // Parsed bodies for every other route. A request whose body was captured
  // above is skipped by these.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
}
