const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  ok: boolean;
  reason?: string;
  bypassed?: boolean;
  errors?: unknown[];
}

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Dev/test ergonomics: allow bypass locally. In production the absence
    // of a configured secret is a fail-closed condition — hosted provisioning
    // must refuse to run without bot protection.
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: 'unconfigured' };
    }
    return { ok: true, bypassed: true };
  }
  if (!token) {
    return { ok: false, reason: 'missing_token' };
  }
  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', token);
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
    const json = (await res.json()) as { success?: boolean; 'error-codes'?: unknown[] };
    if (json.success) return { ok: true };
    return { ok: false, reason: 'cf_rejected', errors: json['error-codes'] || [] };
  } catch (err) {
    console.error('[HOSTED] turnstile verify failed:', (err as Error)?.message);
    return { ok: false, reason: 'verify_failed' };
  }
}
