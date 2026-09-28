// Shared atomic counters in Postgres (app.usage_hit): every Edge Function
// instance sees the same numbers, so limits hold under horizontal scaling.
import {db, mapDbErrors} from './db.ts';
import {HttpError} from './http.ts';
import {envInt} from './env.ts';

export type Limit = {bucket: string; windowSeconds: number; max: number; cost?: number};

export async function hit(limit: Limit): Promise<{allowed: boolean; count: number; resetAt: string}> {
  const rows = await mapDbErrors(
    () => db()`select app.usage_hit(${limit.bucket}, ${limit.windowSeconds}, ${limit.max}, ${limit.cost ?? 1}) as r`,
  );
  return rows[0]!.r as {allowed: boolean; count: number; resetAt: string};
}

export async function enforce(...limits: Limit[]) {
  for (const limit of limits) {
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

export const PUBLIC_LIMITS = {
  read: (ip: string): Limit => ({bucket: `pub:read:${ip}`, windowSeconds: 60, max: envInt('RL_PUBLIC_READ_PER_MIN', 120)}),
  create: (ip: string): Limit => ({bucket: `pub:create:${ip}`, windowSeconds: 600, max: envInt('RL_BOOKINGS_PER_10MIN', 6)}),
  createTenant: (slug: string): Limit => ({bucket: `pub:create:t:${slug}`, windowSeconds: 3600, max: envInt('RL_TENANT_BOOKINGS_PER_HOUR', 120)}),
  token: (ip: string): Limit => ({bucket: `pub:token:${ip}`, windowSeconds: 60, max: envInt('RL_TOKEN_OPS_PER_MIN', 60)}),
  owner: (user: string): Limit => ({bucket: `owner:${user}`, windowSeconds: 60, max: envInt('RL_OWNER_PER_MIN', 300)}),
};
