// Public-safe subset of hosted config. Safe to serialize to client components.
// Never include secrets (TURNSTILE_SECRET_KEY, HOSTED_CLEANUP_SECRET, etc.).

export interface PublicHostedConfig {
  hostedMode: boolean;
  turnstileSiteKey: string | null;
}

export function publicHostedConfig(): PublicHostedConfig {
  const hostedMode = process.env.DASHCLAW_HOSTED === 'true';
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
  return { hostedMode, turnstileSiteKey };
}
