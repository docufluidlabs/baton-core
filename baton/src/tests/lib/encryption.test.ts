import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

// Set encryption key before importing the module
process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests';

// Must use dynamic import after setting env
let encrypt: any, decrypt: any, serializeEncrypted: any, deserializeEncrypted: any, encryptToken: any, decryptToken: any;

beforeAll(async () => {
  // Mock env module to provide the key
  vi.mock('../../env', () => ({
    default: { TOKEN_ENCRYPTION_KEY: 'test-encryption-key-for-unit-tests' },
  }));

  const mod = await import('../../lib/encryption');
  encrypt = mod.encrypt;
  decrypt = mod.decrypt;
  serializeEncrypted = mod.serializeEncrypted;
  deserializeEncrypted = mod.deserializeEncrypted;
  encryptToken = mod.encryptToken;
  decryptToken = mod.decryptToken;
});

// ─── encrypt / decrypt ──────────────────────────────────────

describe('encrypt / decrypt round-trip', () => {
  it('basic string', () => {
    const original = 'hello world';
    const encrypted = encrypt(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it('special characters', () => {
    const original = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./~`\n\ttabs and newlines';
    const encrypted = encrypt(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it('long token string', () => {
    const original = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.' + 'x'.repeat(500);
    const encrypted = encrypt(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it('each encrypt produces different IV', () => {
    const text = 'same text';
    const a = encrypt(text);
    const b = encrypt(text);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('encrypted data has required fields', () => {
    const encrypted = encrypt('test');
    expect(encrypted).toHaveProperty('ciphertext');
    expect(encrypted).toHaveProperty('iv');
    expect(encrypted).toHaveProperty('tag');
    expect(typeof encrypted.ciphertext).toBe('string');
    expect(typeof encrypted.iv).toBe('string');
    expect(typeof encrypted.tag).toBe('string');
  });
});

// ─── serialize / deserialize ────────────────────────────────

describe('serializeEncrypted / deserializeEncrypted', () => {
  it('round-trip preserves data', () => {
    const data = { iv: 'aabbcc', tag: 'ddeeff', ciphertext: '112233' };
    const serialized = serializeEncrypted(data);
    expect(deserializeEncrypted(serialized)).toEqual(data);
  });

  it('invalid format throws', () => {
    expect(() => deserializeEncrypted('invalid')).toThrow('Invalid encrypted data format');
  });
});

// ─── encryptToken / decryptToken ────────────────────────────

describe('encryptToken / decryptToken', () => {
  it('round-trip returns original', () => {
    const token = 'my-secret-oauth-token-12345';
    const stored = encryptToken(token);
    expect(decryptToken(stored)).toBe(token);
  });

  it('tampered data throws on decrypt', () => {
    const stored = encryptToken('test');
    const tampered = stored.replace(stored[10], stored[10] === 'a' ? 'b' : 'a');
    expect(() => decryptToken(tampered)).toThrow();
  });
});
