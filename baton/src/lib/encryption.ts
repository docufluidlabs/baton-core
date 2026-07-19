/**
 * AES-256-GCM Encryption Service
 * Upgraded from CBC (existing procore pattern) to GCM for authenticated encryption
 */
import * as crypto from 'crypto';
import env from '../env';
import { logError, logDebug } from './logger';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  tag: string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM
const TAG_LENGTH = 16;

let secretKey: Buffer;

function getKey(): Buffer {
  if (!secretKey) {
    if (!env.TOKEN_ENCRYPTION_KEY) {
      throw new Error('TOKEN_ENCRYPTION_KEY is required for token encryption');
    }
    // Derive a 32-byte key from the environment variable
    secretKey = crypto.scryptSync(env.TOKEN_ENCRYPTION_KEY, 'baton-salt', 32);
  }
  return secretKey;
}

/**
 * Encrypts a string using AES-256-GCM
 */
export function encrypt(text: string): EncryptedData {
  try {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

    let ciphertext = cipher.update(text, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    logDebug('Token encrypted successfully (AES-256-GCM)');

    return { ciphertext, iv: iv.toString('hex'), tag };
  } catch (error) {
    logError('Failed to encrypt token', error);
    throw new Error('Token encryption failed');
  }
}

/**
 * Decrypts encrypted data using AES-256-GCM
 */
export function decrypt(encryptedData: EncryptedData): string {
  try {
    const key = getKey();
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const tag = Buffer.from(encryptedData.tag, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedData.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    logDebug('Token decrypted successfully (AES-256-GCM)');
    return decrypted;
  } catch (error) {
    logError('Failed to decrypt token', error);
    throw new Error('Token decryption failed — token may be corrupted or key changed');
  }
}

/**
 * Serialize EncryptedData to a single string for DB storage
 */
export function serializeEncrypted(data: EncryptedData): string {
  return `${data.iv}:${data.tag}:${data.ciphertext}`;
}

/**
 * Deserialize a stored string back to EncryptedData
 */
export function deserializeEncrypted(stored: string): EncryptedData {
  const [iv, tag, ciphertext] = stored.split(':');
  if (!iv || !tag || !ciphertext) {
    throw new Error('Invalid encrypted data format');
  }
  return { iv, tag, ciphertext };
}

/**
 * Convenience: encrypt and serialize in one step
 */
export function encryptToken(token: string): string {
  return serializeEncrypted(encrypt(token));
}

/**
 * Convenience: deserialize and decrypt in one step
 */
export function decryptToken(stored: string): string {
  return decrypt(deserializeEncrypted(stored));
}
