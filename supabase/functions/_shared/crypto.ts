// Booking access tokens.
// token = base64url(HMAC-SHA256(BOOKING_TOKEN_SECRET, "booking:v1:<slug>:<idempotencyKey>"))
// Only SHA-256(token) is stored. Because the token is derived from the
// client's idempotency key, a retried request (lost response, flaky network)
// re-issues exactly the same access link without the database ever holding it.
import {env} from './env.ts';

const enc = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}

function tokenSecret(): string {
  const s = env('BOOKING_TOKEN_SECRET');
  if (s.length < 32) throw new Error('BOOKING_TOKEN_SECRET must be at least 32 characters');
  return s;
}

export async function deriveBookingToken(slug: string, idempotencyKey: string): Promise<string> {
  return base64url(await hmac(tokenSecret(), `booking:v1:${slug}:${idempotencyKey.toLowerCase()}`));
}

export async function tokenHash(token: string): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(token);
}

/** Pseudonymous rate-limit key: raw IPs are never written to the database. */
export async function ipKey(ip: string): Promise<string> {
  const bytes = await hmac(tokenSecret(), `ip:${ip}`);
  return base64url(bytes.slice(0, 12));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
