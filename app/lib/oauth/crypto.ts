// app/lib/oauth/crypto.js
import crypto from 'node:crypto';

export function base64url(buf: crypto.BinaryLike | ArrayBuffer | NodeJS.ArrayBufferView): string {
  return Buffer.from(buf as Buffer).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sha256Hex(input: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Same hex digest the Edge middleware produces via hashApiKey() (Web Crypto),
// so a token hashed here in a Node route matches a middleware lookup.
export function hashToken(token: crypto.BinaryLike): string {
  return sha256Hex(token);
}

export function newOpaqueToken(prefix: string): string {
  return `${prefix}_${base64url(crypto.randomBytes(32))}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// PKCE S256: base64url(SHA-256(verifier)) === challenge, constant-time.
export function verifyPkceS256(verifier: unknown, challenge: unknown): boolean {
  if (typeof verifier !== 'string' || typeof challenge !== 'string' || !verifier || !challenge) {
    return false;
  }
  const computed = base64url(crypto.createHash('sha256').update(verifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
