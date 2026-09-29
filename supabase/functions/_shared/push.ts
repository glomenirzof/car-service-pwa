// Web Push (RFC 8030/8291/8292). web-push builds the VAPID JWT and the
// aes128gcm-encrypted body; the request itself goes out with fetch().
import webpush from 'web-push';
import {env, optionalEnv} from './env.ts';

export type Subscription = {endpoint: string; p256dh: string; auth: string};
export type PushPayload = {title: string; body: string; url: string; tag: string};
export type PushResult = {endpoint: string; status: number; ok: boolean; gone: boolean; retryable: boolean; error?: string};

export function vapidConfigured(): boolean {
  return Boolean(optionalEnv('VAPID_PUBLIC_KEY') && optionalEnv('VAPID_PRIVATE_KEY') && optionalEnv('VAPID_SUBJECT'));
}

export async function sendPush(sub: Subscription, payload: PushPayload, ttlSeconds = 6 * 3600): Promise<PushResult> {
  const details = webpush.generateRequestDetails(
    {endpoint: sub.endpoint, keys: {p256dh: sub.p256dh, auth: sub.auth}},
    JSON.stringify(payload),
    {
      vapidDetails: {subject: env('VAPID_SUBJECT'), publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY')},
      TTL: ttlSeconds,
      urgency: 'normal',
      contentEncoding: 'aes128gcm',
    },
  );
  try {
    const res = await fetch(details.endpoint, {
      method: details.method,
      headers: details.headers as Record<string, string>,
      body: details.body ? new Uint8Array(details.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel();
    return {
      endpoint: sub.endpoint,
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      gone: res.status === 404 || res.status === 410,
      retryable: res.status === 429 || res.status >= 500,
    };
  } catch (error) {
    return {endpoint: sub.endpoint, status: 0, ok: false, gone: false, retryable: true, error: (error as Error).message};
  }
}
