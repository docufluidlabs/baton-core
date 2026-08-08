/**
 * Generate infrastructure/dynamodb.yml from src/db/table-definitions.ts
 *
 * Usage: npm run infra:generate
 *
 * The application code is the source of truth for table schemas and GSI names —
 * this keeps the CloudFormation template in exact parity (the pre-generator
 * template had drifted: missing tables and mismatched index names).
 *
 * House style preserved: PAY_PER_REQUEST billing, DeletionPolicy Retain,
 * conditional PITR, KMS SSE, Environment/Application tags, per-table ARN exports.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { tableDefinitions } from '../src/db/table-definitions';
import { TableNames } from '../src/db/client';
import env from '../src/env';

const PREFIX = env.DYNAMODB_TABLE_PREFIX; // 'baton-' by default

// TTL-based tables — must stay in sync with TTL_SPECS in src/db/ensure-tables.ts.
const TTL_SPECS: Record<string, string> = {
  [TableNames.OAUTH_STATES]: 'ttl',
  [TableNames.BOOTSTRAP_TOKENS]: 'expiresAt',
};

function suffixOf(tableName: string): string {
  if (!tableName.startsWith(PREFIX)) {
    throw new Error(`Table "${tableName}" does not start with prefix "${PREFIX}"`);
  }
  return tableName.slice(PREFIX.length);
}

function pascal(suffix: string): string {
  return suffix
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

const lines: string[] = [];
const out = (s = '') => lines.push(s);

out(`AWSTemplateFormatVersion: '2010-09-09'`);
out(`Description: 'Baton — DynamoDB Tables'`);
out();
out(`# ─────────────────────────────────────────────────────────────────────────`);
out(`# GENERATED FILE — do not edit by hand.`);
out(`# Source of truth: baton/src/db/table-definitions.ts`);
out(`# Regenerate with:  cd baton && npm run infra:generate`);
out(`# Intended for fresh stacks; DynamoDB allows only one GSI change per stack`);
out(`# update, so reconciling a drifted existing stack may need multiple deploys.`);
out(`# ─────────────────────────────────────────────────────────────────────────`);
out();
out(`Parameters:`);
out(`  Environment:`);
out(`    Type: String`);
out(`    Default: production`);
out(`    AllowedValues:`);
out(`      - development`);
out(`      - staging`);
out(`      - production`);
out(`    Description: Deployment environment`);
out();
out(`  TablePrefix:`);
out(`    Type: String`);
out(`    Default: ${PREFIX}`);
out(`    Description: Prefix for DynamoDB table names`);
out();
out(`  EnablePointInTimeRecovery:`);
out(`    Type: String`);
out(`    Default: 'true'`);
out(`    AllowedValues:`);
out(`      - 'true'`);
out(`      - 'false'`);
out();
out(`Conditions:`);
out(`  IsProduction: !Equals [!Ref Environment, 'production']`);
out(`  EnablePITR: !Equals [!Ref EnablePointInTimeRecovery, 'true']`);
out();
out(`Resources:`);

for (const def of tableDefinitions) {
  const tableName = def.TableName!;
  const suffix = suffixOf(tableName);
  const logical = `${pascal(suffix)}Table`;

  // Fail loudly on any schema feature the generator does not emit.
  const handled = new Set([
    'TableName',
    'KeySchema',
    'AttributeDefinitions',
    'GlobalSecondaryIndexes',
    'ProvisionedThroughput', // ignored: CFN uses PAY_PER_REQUEST
  ]);
  for (const key of Object.keys(def)) {
    if (!handled.has(key)) {
      throw new Error(`Table "${tableName}": unhandled schema field "${key}" — extend generate-dynamodb-cfn.ts`);
    }
  }

  out(`  # ============= ${pascal(suffix)} =============`);
  out(`  ${logical}:`);
  out(`    Type: AWS::DynamoDB::Table`);
  out(`    DeletionPolicy: Retain`);
  out(`    UpdateReplacePolicy: Retain`);
  out(`    Properties:`);
  out(`      TableName: !Sub '\${TablePrefix}${suffix}'`);
  out(`      BillingMode: PAY_PER_REQUEST`);

  out(`      AttributeDefinitions:`);
  for (const attr of def.AttributeDefinitions ?? []) {
    out(`        - AttributeName: ${attr.AttributeName}`);
    out(`          AttributeType: ${attr.AttributeType}`);
  }

  out(`      KeySchema:`);
  for (const key of def.KeySchema ?? []) {
    out(`        - AttributeName: ${key.AttributeName}`);
    out(`          KeyType: ${key.KeyType}`);
  }

  const gsis = def.GlobalSecondaryIndexes ?? [];
  if (gsis.length > 0) {
    out(`      GlobalSecondaryIndexes:`);
    for (const gsi of gsis) {
      out(`        - IndexName: ${gsi.IndexName}`);
      out(`          KeySchema:`);
      for (const key of gsi.KeySchema ?? []) {
        out(`            - AttributeName: ${key.AttributeName}`);
        out(`              KeyType: ${key.KeyType}`);
      }
      out(`          Projection:`);
      out(`            ProjectionType: ${gsi.Projection?.ProjectionType ?? 'ALL'}`);
    }
  }

  const ttlAttr = TTL_SPECS[tableName];
  if (ttlAttr) {
    out(`      TimeToLiveSpecification:`);
    out(`        Enabled: true`);
    out(`        AttributeName: ${ttlAttr}`);
  }

  out(`      PointInTimeRecoverySpecification:`);
  out(`        PointInTimeRecoveryEnabled: !If [EnablePITR, true, false]`);
  out(`      SSESpecification:`);
  out(`        SSEEnabled: true`);
  out(`        SSEType: KMS`);
  out(`      Tags:`);
  out(`        - Key: Environment`);
  out(`          Value: !Ref Environment`);
  out(`        - Key: Application`);
  out(`          Value: baton`);
  out();
}

out(`Outputs:`);
for (const def of tableDefinitions) {
  const suffix = suffixOf(def.TableName!);
  const logical = `${pascal(suffix)}Table`;
  out(`  ${logical}Arn:`);
  out(`    Value: !GetAtt ${logical}.Arn`);
  out(`    Export:`);
  out(`      Name: !Sub '\${AWS::StackName}-${logical}Arn'`);
  out();
}

const target = join(__dirname, '..', 'infrastructure', 'dynamodb.yml');
writeFileSync(target, lines.join('\n'), 'utf8');
console.log(`✨ Wrote ${tableDefinitions.length} tables to ${target}`);
