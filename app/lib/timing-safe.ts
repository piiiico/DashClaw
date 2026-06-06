/**
 * Timing-safe string comparison for secret validation.
 * Uses Node.js crypto.timingSafeEqual to prevent timing attacks.
 */
import crypto from 'crypto';

export function timingSafeCompare(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against self to consume constant time, then return false
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
