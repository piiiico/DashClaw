import crypto from 'crypto';

// v2 format uses AEAD (GCM) to provide confidentiality + integrity.
const V2_PREFIX = 'v2';
const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12; // 96-bit nonce recommended for GCM

// Legacy v1 format (CBC) is supported for backward-compatible decrypt only.
const LEGACY_ALGORITHM = 'aes-256-cbc';

function getKeyBytes(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set');

  // Keep existing "32 characters" requirement, but enforce 32 bytes in practice.
  if (key.length !== 32 || Buffer.byteLength(key, 'utf8') !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (32 ASCII characters recommended)');
  }
  return Buffer.from(key, 'utf8');
}

/**
 * Encrypt a string using AES-256-GCM (AEAD).
 *
 * Format:
 *   v2:{ivHex}:{tagHex}:{cipherHex}
 */
export function encrypt(text: unknown, aad = ''): string {
  const keyBytes = getKeyBytes();
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, keyBytes, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${V2_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

function decryptV2(text: string, aad = ''): string | null {
  const keyBytes = getKeyBytes();
  const parts = String(text).split(':');
  // Expected: v2:iv:tag:cipher
  if (parts.length !== 4 || parts[0] !== V2_PREFIX) return null;

  const iv = Buffer.from(parts[1] as string, 'hex');
  const tag = Buffer.from(parts[2] as string, 'hex');
  const ciphertext = Buffer.from(parts[3] as string, 'hex');

  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, keyBytes, iv);
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

function decryptLegacyCbc(text: string): string {
  const keyBytes = getKeyBytes();
  const textParts = String(text).split(':');
  const iv = Buffer.from(textParts.shift() as string, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, keyBytes, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Decrypt a string produced by encrypt().
 * Supports legacy CBC ciphertexts for backward compatibility.
 */
export function decrypt(text: unknown, aad = ''): string | null {
  try {
    if (typeof text !== 'string' || text.length === 0) return null;

    // v2 AEAD path (preferred)
    if (text.startsWith(`${V2_PREFIX}:`)) {
      return decryptV2(text, aad);
    }

    // legacy v1 CBC path
    return decryptLegacyCbc(text);
  } catch (err) {
    console.error('[ENCRYPTION] Decryption failed:', (err as Error)?.message);
    return null;
  }
}
