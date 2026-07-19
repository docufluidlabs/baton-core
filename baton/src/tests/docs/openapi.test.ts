import { describe, it, expect } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildOpenApiDocument } from '../../docs';

describe('OpenAPI spec', () => {
  const spec = buildOpenApiDocument();

  it('declares OpenAPI 3.0.3', () => {
    expect(spec.openapi).toBe('3.0.3');
  });

  it('passes Swagger Parser validation', async () => {
    // Use validate() with a deep clone — SwaggerParser mutates the doc in place
    // (resolves $refs) and the registry is a singleton across the test run.
    const cloned = JSON.parse(JSON.stringify(spec));
    await SwaggerParser.validate(cloned);
  });

  it('registers all expected tags with at least one operation each', () => {
    const expectedTags = [
      'Workflows', 'Webhook Endpoints', 'Connections', 'Automations',
      'Platforms', 'Settings', 'Slack', 'Flow Layout', 'Salesforce',
      'Auth', 'Instances', 'Events', 'Dashboard', 'Notifications',
      'User Activity',
    ];
    const seen = new Set<string>();
    for (const path of Object.values(spec.paths || {})) {
      for (const op of Object.values(path as Record<string, any>)) {
        for (const tag of (op as any).tags || []) seen.add(tag);
      }
    }
    for (const tag of expectedTags) {
      expect(seen, `tag ${tag} should appear on at least one operation`).toContain(tag);
    }
  });

  it('registers bearerAuth and devBypass security schemes', () => {
    const schemes = spec.components?.securitySchemes || {};
    expect(Object.keys(schemes)).toEqual(expect.arrayContaining(['bearerAuth', 'devBypass']));
  });

  it('has ErrorResponse component', () => {
    const schemas = spec.components?.schemas || {};
    expect(schemas).toHaveProperty('ErrorResponse');
  });

  it('inbound webhooks are documented only under the "Inbound Webhooks" tag', () => {
    const inboundPrefixes = [
      '/api/webhooks/',
      '/api/postwebhook',
      '/api/slack/events',
      '/api/slack/install',
      '/api/salesforce/webhook-registrations',
    ];
    let inboundOps = 0;
    for (const [path, pathItem] of Object.entries(spec.paths || {})) {
      if (!inboundPrefixes.some((pre) => path.startsWith(pre))) continue;
      for (const op of Object.values(pathItem as Record<string, any>)) {
        inboundOps++;
        expect((op as any).tags, `${path} should be tagged "Inbound Webhooks"`).toContain('Inbound Webhooks');
      }
    }
    expect(inboundOps, 'at least some inbound webhooks should be documented').toBeGreaterThan(0);
  });
});
