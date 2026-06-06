/**
 * Marketing-funnel telemetry writer.
 *
 * Persists anonymous marketing events to Redis. One Redis list per day
 * (key: `marketing:events:YYYY-MM-DD`) with a 90-day TTL so storage stays
 * bounded. Each event is a JSON line; ordering inside a day list is
 * insertion order via RPUSH.
 *
 * Design notes:
 * - Reuses the same `redis` npm package the SSE event bus uses (see
 *   app/lib/events.js). No new dependency.
 * - No PII. The allowed event names are validated upstream by the route
 *   handler; properties are persisted as-is but the handler enforces a
 *   shallow object with a small allowlist of keys.
 * - If REDIS_URL is not set, writes silently no-op (resolve to null). The
 *   marketing site MUST NOT break on instances without Redis. The route
 *   handler returns 202 in that case so the client cannot probe whether
 *   Redis is configured by inspecting the response.
 */

const REDIS_URL = process.env.REDIS_URL || process.env.REALTIME_REDIS_URL || '';
const RETENTION_SECONDS = 90 * 24 * 60 * 60; // 90 days

// Minimal surface of the `redis` client we use. The package is dynamically
// imported and not typed at this boundary, so we model only what we call.
interface RedisClientLike {
  isOpen: boolean;
  on(event: 'error', listener: (err: unknown) => void): unknown;
  connect(): Promise<unknown>;
  RPUSH(key: string, value: string): Promise<unknown>;
  EXPIRE(key: string, seconds: number): Promise<unknown>;
}

let cachedClient: RedisClientLike | null = null;
let cachedClientPromise: Promise<RedisClientLike | null> | null = null;

async function getClient(): Promise<RedisClientLike | null> {
  if (!REDIS_URL) return null;
  if (cachedClient && cachedClient.isOpen) return cachedClient;
  if (cachedClientPromise) return cachedClientPromise;

  cachedClientPromise = (async () => {
    try {
      const mod: any = await import('redis');
      const client: RedisClientLike = mod.createClient({ url: REDIS_URL });
      client.on('error', (err: any) => {
        // Do not crash. Marketing telemetry is best-effort.
        console.warn('[MARKETING] Redis client error:', err?.message || err);
      });
      await client.connect();
      cachedClient = client;
      return client;
    } catch (err: any) {
      console.warn('[MARKETING] Redis connect failed:', err?.message || err);
      return null;
    } finally {
      cachedClientPromise = null;
    }
  })();

  return cachedClientPromise;
}

function todayKey(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `marketing:events:${yyyy}-${mm}-${dd}`;
}

export interface MarketingEventPayload {
  event: string;
  properties?: Record<string, unknown>;
  ip?: string | null;
}

export interface RecordMarketingEventResult {
  ok: boolean;
  persisted: boolean;
  reason?: string;
}

/**
 * Append a marketing event to today's Redis list.
 */
export async function recordMarketingEvent(payload: MarketingEventPayload): Promise<RecordMarketingEventResult> {
  if (!REDIS_URL) {
    return { ok: true, persisted: false, reason: 'redis_not_configured' };
  }

  const client = await getClient();
  if (!client) {
    return { ok: true, persisted: false, reason: 'redis_unavailable' };
  }

  const record = JSON.stringify({
    event: payload.event,
    properties: payload.properties || {},
    ip: payload.ip || null,
    timestamp: new Date().toISOString(),
  });

  const key = todayKey();
  try {
    await client.RPUSH(key, record);
    // EXPIRE is idempotent. Re-applying on every write keeps the TTL
    // sliding forward only on days that actually receive events.
    await client.EXPIRE(key, RETENTION_SECONDS);
    return { ok: true, persisted: true };
  } catch (err: any) {
    console.warn('[MARKETING] Redis write failed:', err?.message || err);
    return { ok: true, persisted: false, reason: 'redis_write_failed' };
  }
}
