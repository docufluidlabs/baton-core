/**
 * SF Registration — composite (sfOrgId, webhookKey) keying tests
 *
 * Regression suite for the "two rules, one SF org" secret-overwrite bug:
 * the original keying stored ONE secret per sfOrgId under
 * OrgApp.sfRegistrations, shared by every automation rule of the app. The
 * Apex package caches one secret per webhookKey, so registering rule B
 * silently invalidated rule A's HMAC → deterministic 401 "Invalid signature"
 * on A's next dispatch, unrecoverable via auto-heal (idempotent replay
 * returns the original — stale — secret).
 *
 * Covers:
 *   1. Two rules of the same app, same SF org → independent composite entries,
 *      no overwrite.
 *   2. resolveSfRegistration precedence: composite → legacy bare sfOrgId → miss.
 *   3. Idempotent replay self-heal: token redeemed but never persisted
 *      (crash window) → replay re-persists the cached secret and marks the
 *      token persisted.
 *   4. Idempotent replay with persisted=true → returns cached response,
 *      writes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Request, Response, NextFunction } from 'express';

// ─── In-memory fixtures shared between mocks and tests ──────

const SF_ORG = '00DC3000003B7ndMAC';
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const TOKEN_A = 'btn_tokenA_aaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'btn_tokenB_bbbbbbbbbbbbbbbbbbbb';

interface FakeState {
  rules: Record<string, any>;   // webhookKey → AutomationRule
  apps: Record<string, any>;    // appId → OrgApp
  tokens: Record<string, any>;  // tokenId → BootstrapToken
}

const state: FakeState = { rules: {}, apps: {}, tokens: {} };

function resetState() {
  state.apps = {
    'app-1': {
      id: 'app-1',
      orgId: 'org-1',
      appSlug: 'salesforce',
      status: 'active',
      sfRegistrations: undefined,
    },
  };
  state.rules = {
    [KEY_A]: { id: 'rule-A', orgId: 'org-1', appId: 'app-1', appSlug: 'salesforce', status: 'active', webhookKey: KEY_A },
    [KEY_B]: { id: 'rule-B', orgId: 'org-1', appId: 'app-1', appSlug: 'salesforce', status: 'active', webhookKey: KEY_B },
  };
  state.tokens = {};
}

// ─── Mocks ───────────────────────────────────────────────────

vi.mock('../../lib/logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock('../../lib/encryption', () => ({
  encryptToken: vi.fn((s: string) => `enc(${s})`),
  decryptToken: vi.fn((s: string) => s.replace(/^enc\(/, '').replace(/\)$/, '')),
}));

// Fake DDB doc client: emulates only the command shapes sf-registration uses.
vi.mock('../../db/client', () => {
  return {
    TableNames: {
      AUTOMATION_RULES: 'automation-rules',
      ORG_APPS: 'org-apps',
      BOOTSTRAP_TOKENS: 'bootstrap-tokens',
    },
    getDocClient: () => ({
      send: async (cmd: any) => {
        const input = cmd.input;
        const isQuery = cmd instanceof QueryCommand;
        const isGet = cmd instanceof GetCommand;
        const isUpdate = cmd instanceof UpdateCommand;

        if (isQuery && input.TableName === 'automation-rules') {
          const wk = input.ExpressionAttributeValues[':wk'];
          const rule = state.rules[wk];
          return { Items: rule ? [rule] : [] };
        }
        if (isGet && input.TableName === 'org-apps') {
          return { Item: state.apps[input.Key.id] };
        }
        if (isUpdate && input.TableName === 'org-apps') {
          const app = state.apps[input.Key.id];
          if (!app) throw new Error('app not found');
          if (input.UpdateExpression.includes('if_not_exists')) {
            app.sfRegistrations = app.sfRegistrations ?? {};
            return {};
          }
          if (input.UpdateExpression.includes('sfRegistrations.#regKey')) {
            const mapKey = input.ExpressionAttributeNames['#regKey'];
            app.sfRegistrations[mapKey] = input.ExpressionAttributeValues[':reg'];
            return {};
          }
          throw new Error(`Unhandled org-apps UpdateExpression: ${input.UpdateExpression}`);
        }
        throw new Error(`Unhandled command for table ${input.TableName}`);
      },
    }),
  };
});

// Fake bootstrap-token service with real-ish redemption semantics:
// first call with a token → fresh redemption (persisted=false), same
// idempotency key again → isIdempotentReplay with the stored token record.
vi.mock('../../services/bootstrap-token.service', () => ({
  redeemBootstrapToken: vi.fn(async (params: any) => {
    const existing = state.tokens[params.tokenId];
    if (existing?.redeemed) {
      if (existing.idempotencyKey === params.idempotencyKey) {
        return { token: existing, isIdempotentReplay: true };
      }
      throw new Error('ConflictError: already redeemed');
    }
    const token = {
      tokenId: params.tokenId,
      webhookKey: params.webhookKey,
      redeemed: true,
      redeemedAt: '2026-06-10T10:00:00.000Z',
      redeemedBySfOrgId: params.sfOrgId,
      idempotencyKey: params.idempotencyKey,
      registrationResponse: params.registrationResponse,
      persisted: false,
    };
    state.tokens[params.tokenId] = token;
    return { token, isIdempotentReplay: false };
  }),
  markBootstrapTokenPersisted: vi.fn(async (tokenId: string) => {
    const t = state.tokens[tokenId];
    if (!t) throw new Error('token not found');
    t.persisted = true;
  }),
}));

import { handleSfRegistration } from '../../routes/sf-registration';
import { resolveSfRegistration, sfRegKey } from '../../lib/sf-registration-key';
import { markBootstrapTokenPersisted } from '../../services/bootstrap-token.service';

// ─── Helpers ─────────────────────────────────────────────────

function makeReqRes(body: Record<string, any>, idempotencyKey: string) {
  const req = {
    header: (name: string) => (name.toLowerCase() === 'idempotency-key' ? idempotencyKey : undefined),
    body,
  } as unknown as Request;

  const captured: { status?: number; json?: any } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(payload: any) { captured.json = payload; return this; },
  } as unknown as Response;

  const nextErrors: any[] = [];
  const next: NextFunction = (err?: any) => { if (err) nextErrors.push(err); };

  return { req, res, next, captured, nextErrors };
}

function registrationBody(webhookKey: string, token: string, secret: string) {
  return {
    webhookKey,
    bootstrapToken: token,
    sfOrgId: SF_ORG,
    generatedSecret: secret,
    packageVersion: '0.8.0-1',
  };
}

function idemKey(webhookKey: string, token: string) {
  return `${SF_ORG}_${webhookKey}_${token}`;
}

// ─── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  resetState();
  vi.clearAllMocks();
});

describe('sf-registration composite keying', () => {
  it('two rules of the same app, same SF org → independent entries, no overwrite', async () => {
    // Rule A registers with secretA
    const a = makeReqRes(registrationBody(KEY_A, TOKEN_A, 'secretA_aaaaaaaaaaaaaaaa'), idemKey(KEY_A, TOKEN_A));
    await handleSfRegistration(a.req, a.res, a.next);
    expect(a.nextErrors).toEqual([]);
    expect(a.captured.status).toBe(200);

    // Rule B registers with secretB
    const b = makeReqRes(registrationBody(KEY_B, TOKEN_B, 'secretB_bbbbbbbbbbbbbbbb'), idemKey(KEY_B, TOKEN_B));
    await handleSfRegistration(b.req, b.res, b.next);
    expect(b.nextErrors).toEqual([]);
    expect(b.captured.status).toBe(200);

    const regs = state.apps['app-1'].sfRegistrations;
    expect(Object.keys(regs).sort()).toEqual([
      sfRegKey(SF_ORG, KEY_A),
      sfRegKey(SF_ORG, KEY_B),
    ].sort());

    // The regression: rule B's registration must NOT have touched rule A's secret
    expect(regs[sfRegKey(SF_ORG, KEY_A)].secretKeyEnc).toBe('enc(secretA_aaaaaaaaaaaaaaaa)');
    expect(regs[sfRegKey(SF_ORG, KEY_B)].secretKeyEnc).toBe('enc(secretB_bbbbbbbbbbbbbbbb)');
  });

  it('marks the bootstrap token persisted after a successful registration', async () => {
    const a = makeReqRes(registrationBody(KEY_A, TOKEN_A, 'secretA_aaaaaaaaaaaaaaaa'), idemKey(KEY_A, TOKEN_A));
    await handleSfRegistration(a.req, a.res, a.next);

    expect(markBootstrapTokenPersisted).toHaveBeenCalledWith(TOKEN_A);
    expect(state.tokens[TOKEN_A].persisted).toBe(true);
  });
});

describe('resolveSfRegistration precedence', () => {
  const composite = { secretKeyEnc: 'enc(composite)', secretVersion: 1, registeredAt: 'x' };
  const legacy = { secretKeyEnc: 'enc(legacy)', secretVersion: 1, registeredAt: 'y' };

  it('prefers the composite entry when both exist', () => {
    const app = { sfRegistrations: { [sfRegKey(SF_ORG, KEY_A)]: composite, [SF_ORG]: legacy } };
    const resolved = resolveSfRegistration(app, SF_ORG, KEY_A);
    expect(resolved?.entry.secretKeyEnc).toBe('enc(composite)');
    expect(resolved?.isLegacy).toBe(false);
  });

  it('falls back to the legacy bare-sfOrgId entry', () => {
    const app = { sfRegistrations: { [SF_ORG]: legacy } };
    const resolved = resolveSfRegistration(app, SF_ORG, KEY_A);
    expect(resolved?.entry.secretKeyEnc).toBe('enc(legacy)');
    expect(resolved?.isLegacy).toBe(true);
  });

  it('one rule resolves its own secret without seeing the other rule’s', () => {
    const app = {
      sfRegistrations: {
        [sfRegKey(SF_ORG, KEY_A)]: { ...composite, secretKeyEnc: 'enc(secretA)' },
        [sfRegKey(SF_ORG, KEY_B)]: { ...composite, secretKeyEnc: 'enc(secretB)' },
      },
    };
    expect(resolveSfRegistration(app, SF_ORG, KEY_A)?.entry.secretKeyEnc).toBe('enc(secretA)');
    expect(resolveSfRegistration(app, SF_ORG, KEY_B)?.entry.secretKeyEnc).toBe('enc(secretB)');
  });

  it('returns undefined when neither composite nor legacy entry exists', () => {
    const app = { sfRegistrations: { [sfRegKey(SF_ORG, KEY_B)]: composite } };
    expect(resolveSfRegistration(app, SF_ORG, KEY_A)).toBeUndefined();
  });
});

describe('idempotent replay self-heal', () => {
  it('re-persists the cached secret when the original request never persisted it (crash window)', async () => {
    // Simulate: token redeemed, response cached, but the OrgApp write never
    // happened (process crashed between redemption and persistence).
    state.tokens[TOKEN_A] = {
      tokenId: TOKEN_A,
      webhookKey: KEY_A,
      redeemed: true,
      redeemedAt: '2026-06-10T09:00:00.000Z',
      redeemedBySfOrgId: SF_ORG,
      idempotencyKey: idemKey(KEY_A, TOKEN_A),
      registrationResponse: {
        status: 'registered',
        webhookId: 'wh_original',
        secret: 'originalSecret_aaaaaaaaa',
        secretVersion: 1,
        expiresAt: null,
      },
      persisted: false,
    };

    // Apex retries the registration with the SAME idempotency key.
    const r = makeReqRes(registrationBody(KEY_A, TOKEN_A, 'freshlyGeneratedRetrySecret_x'), idemKey(KEY_A, TOKEN_A));
    await handleSfRegistration(r.req, r.res, r.next);

    expect(r.nextErrors).toEqual([]);
    expect(r.captured.status).toBe(200);
    // Replay must echo the ORIGINAL secret, not the retry's fresh candidate…
    expect(r.captured.json.secret).toBe('originalSecret_aaaaaaaaa');
    expect(r.captured.json.webhookId).toBe('wh_original');

    // …and must have healed the missing OrgApp entry with that same secret.
    const regs = state.apps['app-1'].sfRegistrations;
    expect(regs[sfRegKey(SF_ORG, KEY_A)].secretKeyEnc).toBe('enc(originalSecret_aaaaaaaaa)');
    expect(state.tokens[TOKEN_A].persisted).toBe(true);
  });

  it('returns the cached response without writing when already persisted', async () => {
    state.tokens[TOKEN_A] = {
      tokenId: TOKEN_A,
      webhookKey: KEY_A,
      redeemed: true,
      redeemedAt: '2026-06-10T09:00:00.000Z',
      redeemedBySfOrgId: SF_ORG,
      idempotencyKey: idemKey(KEY_A, TOKEN_A),
      registrationResponse: {
        status: 'registered',
        webhookId: 'wh_original',
        secret: 'originalSecret_aaaaaaaaa',
        secretVersion: 1,
        expiresAt: null,
      },
      persisted: true,
    };

    const r = makeReqRes(registrationBody(KEY_A, TOKEN_A, 'whatever_retry_secret_xxxx'), idemKey(KEY_A, TOKEN_A));
    await handleSfRegistration(r.req, r.res, r.next);

    expect(r.captured.status).toBe(200);
    expect(r.captured.json.secret).toBe('originalSecret_aaaaaaaaa');
    // No OrgApp write happened — the map was never initialized.
    expect(state.apps['app-1'].sfRegistrations).toBeUndefined();
    expect(markBootstrapTokenPersisted).not.toHaveBeenCalled();
  });
});
