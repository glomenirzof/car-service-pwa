// Shared atomic counters in Postgres (app.usage_hit): every Edge Function
// instance sees the same numbers, so limits hold under horizontal scaling.
import {db, mapDbErrors} from './db.ts';
import {HttpError, clientIp} from './http.ts';
import {ipKey} from './crypto.ts';
import {envInt} from './env.ts';

export type Limit = {bucket: string; windowSeconds: number; max: number; cost?: number};

export async function hit(limit: Limit): Promise<{allowed: boolean; count: number; resetAt: string}> {
  const rows = await mapDbErrors(
    () => db()`select app.usage_hit(${limit.bucket}, ${limit.windowSeconds}, ${limit.max}, ${limit.cost ?? 1}) as r`,
  );
  return rows[0]!.r as {allowed: boolean; count: number; resetAt: string};
}

/** Checks every limit in order; null entries (per-client limits without a client key) are skipped. */
export async function enforce(...limits: (Limit | null)[]) {
  for (const limit of limits) {
    if (!limit) continue;
    const r = await hit(limit);
    if (!r.allowed) {
      const retry = Math.max(1, Math.ceil((Date.parse(r.resetAt) - Date.now()) / 1000));
      throw new HttpError(429, 'rate_limited', 'Слишком много запросов', {retryAfterSeconds: retry}, {'Retry-After': String(retry)});
    }
  }
}

export async function usage(bucket: string, windowSeconds: number): Promise<number> {
  const rows = await mapDbErrors(() => db()`select app.usage_get(${bucket}, ${windowSeconds}) as n`);
  return Number(rows[0]!.n);
}

let warnedNoClientIp = false;

/**
 * Keyed (HMAC) client identifier for per-client limits, or null when the
 * platform passes no client IP. Without it a per-client limit would become one
 * global bucket and block every client, so those limits are skipped; per-studio
 * limits and LLM budgets still apply.
 */
export async function clientKey(req: Request): Promise<string | null> {
  const ip = clientIp(req);
  if (ip) return ipKey(ip);
  if (!warnedNoClientIp) {
    warnedNoClientIp = true;
    console.warn('rate limits: no client IP header (see CLIENT_IP_HEADERS); per-client limits are skipped');
  }
  return null;
}

type PerClient = (key: string | null) => Limit | null;
const perClient = (make: (key: string) => Limit): PerClient => (key) => (key ? make(key) : null);

export const PUBLIC_LIMITS = {
  read: perClient((ip) => ({bucket: `pub:read:${ip}`, windowSeconds: 60, max: envInt('RL_PUBLIC_READ_PER_MIN', 120)})),
  create: perClient((ip) => ({bucket: `pub:create:${ip}`, windowSeconds: 600, max: envInt('RL_BOOKINGS_PER_10MIN', 6)})),
  createTenant: (slug: string): Limit => ({bucket: `pub:create:t:${slug}`, windowSeconds: 3600, max: envInt('RL_TENANT_BOOKINGS_PER_HOUR', 120)}),
  token: perClient((ip) => ({bucket: `pub:token:${ip}`, windowSeconds: 60, max: envInt('RL_TOKEN_OPS_PER_MIN', 60)})),
  aiMinute: perClient((ip) => ({bucket: `ai:ip:${ip}`, windowSeconds: 60, max: envInt('RL_AI_PER_MIN', 8)})),
  aiDay: perClient((ip) => ({bucket: `ai:ipd:${ip}`, windowSeconds: 86_400, max: envInt('RL_AI_PER_DAY', 60)})),
  owner: (user: string): Limit => ({bucket: `owner:${user}`, windowSeconds: 60, max: envInt('RL_OWNER_PER_MIN', 300)}),
};
