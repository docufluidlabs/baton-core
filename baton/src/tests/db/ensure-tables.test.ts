import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the waiter so created tables resolve instantly; keep command classes real.
vi.mock('@aws-sdk/client-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-dynamodb')>();
  return {
    ...actual,
    waitUntilTableExists: vi.fn().mockResolvedValue({ state: 'SUCCESS' }),
  };
});

const sendMock = vi.fn();

vi.mock('../../db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/client')>();
  return {
    ...actual,
    getDynamoDBClient: () => ({ send: sendMock }),
  };
});

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { ensureAllTablesExist } from '../../db/ensure-tables';
import { tableDefinitions } from '../../db/table-definitions';
import { TableNames } from '../../db/client';

function notFoundError() {
  const err = new Error('Requested resource not found');
  err.name = 'ResourceNotFoundException';
  return err;
}

beforeEach(() => {
  sendMock.mockReset();
});

describe('ensureAllTablesExist', () => {
  it('reports every table as existing and creates nothing when all describes succeed', async () => {
    sendMock.mockResolvedValue({ Table: { TableStatus: 'ACTIVE' } });

    const result = await ensureAllTablesExist({ createMissing: true });

    expect(result.existing).toHaveLength(tableDefinitions.length);
    expect(result.created).toHaveLength(0);
    const createCalls = sendMock.mock.calls.filter(([cmd]) => cmd instanceof CreateTableCommand);
    expect(createCalls).toHaveLength(0);
  });

  it('creates missing tables and enables TTL on the TTL-based ones', async () => {
    // Every DescribeTable → not found, every other command → success.
    sendMock.mockImplementation((cmd) => {
      if (cmd instanceof DescribeTableCommand) return Promise.reject(notFoundError());
      return Promise.resolve({});
    });

    const result = await ensureAllTablesExist({ createMissing: true });

    expect(result.created).toHaveLength(tableDefinitions.length);
    expect(result.existing).toHaveLength(0);

    const ttlCalls = sendMock.mock.calls
      .filter(([cmd]) => cmd instanceof UpdateTimeToLiveCommand)
      .map(([cmd]) => (cmd as UpdateTimeToLiveCommand).input);
    expect(ttlCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          TableName: TableNames.OAUTH_STATES,
          TimeToLiveSpecification: { Enabled: true, AttributeName: 'ttl' },
        }),
        expect.objectContaining({
          TableName: TableNames.BOOTSTRAP_TOKENS,
          TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAt' },
        }),
      ]),
    );
    expect(ttlCalls).toHaveLength(2);
  });

  it('skips TTL for tables that already existed', async () => {
    sendMock.mockResolvedValue({ Table: { TableStatus: 'ACTIVE' } });

    await ensureAllTablesExist({ createMissing: true });

    const ttlCalls = sendMock.mock.calls.filter(([cmd]) => cmd instanceof UpdateTimeToLiveCommand);
    expect(ttlCalls).toHaveLength(0);
  });

  it('fails with a CloudFormation hint instead of creating when createMissing is false', async () => {
    sendMock.mockImplementation((cmd) => {
      if (cmd instanceof DescribeTableCommand) return Promise.reject(notFoundError());
      return Promise.resolve({});
    });

    await expect(ensureAllTablesExist({ createMissing: false })).rejects.toThrow(
      /does not exist\. Create it via CloudFormation/,
    );

    const createCalls = sendMock.mock.calls.filter(([cmd]) => cmd instanceof CreateTableCommand);
    expect(createCalls).toHaveLength(0);
  });

  it('propagates unexpected describe errors untouched', async () => {
    const boom = new Error('AccessDeniedException: not authorized');
    boom.name = 'AccessDeniedException';
    sendMock.mockRejectedValue(boom);

    await expect(ensureAllTablesExist({ createMissing: true })).rejects.toThrow(
      /not authorized/,
    );
  });

  it('treats TTL enablement failure as non-fatal', async () => {
    sendMock.mockImplementation((cmd) => {
      if (cmd instanceof DescribeTableCommand) return Promise.reject(notFoundError());
      if (cmd instanceof UpdateTimeToLiveCommand) {
        return Promise.reject(new Error('TimeToLive is already enabled'));
      }
      return Promise.resolve({});
    });

    const result = await ensureAllTablesExist({ createMissing: true });
    expect(result.created).toHaveLength(tableDefinitions.length);
  });
});
