// Outbox worker end-to-end on a real database and a local HTTPS push service.
// The receiver verifies the VAPID signature and decrypts the aes128gcm body
// with http_ece (an independent implementation), exactly what a browser's push
// service + user agent do. Real delivery via FCM/APNs/Mozilla is an external
// check (see ACCEPTANCE.md).
import {assert, assertEquals, assertMatch} from '@std/assert';
import {createECDH, randomBytes} from 'node:crypto';
import {Buffer} from 'node:buffer';
import webpush from 'web-push';
import ece from 'http_ece';
import {importJWK, jwtVerify} from 'jose';
import {handler} from '../notify-dispatch/handler.ts';
import {handler as pub} from '../public-api/handler.ts';
import {database, fakePushService, localMoment, makeLive, publish, request, test} from './helpers.ts';

const TZ = 'Europe/Moscow';
const vapid = webpush.generateVAPIDKeys();
Deno.env.set('VAPID_PUBLIC_KEY', vapid.publicKey);
Deno.env.set('VAPID_PRIVATE_KEY', vapid.privateKey);
Deno.env.set('VAPID_SUBJECT', 'mailto:ops@example.test');

function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {ecdh, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url')};
}

const dispatch = (secret = 'test-cron-secret') => handler(new Request('http://functions.test/functions/v1/notify-dispatch', {method: 'POST', headers: {'x-cron-secret': secret}}));

async function vapidPublicJwk() {
  const raw = Buffer.from(vapid.publicKey, 'base64url');
  return importJWK({kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url')}, 'ES256');
}

test('dispatcher requires the cron secret', async () => {
  assertEquals((await dispatch('wrong')).status, 401);
});

test('new booking -> owner receives an encrypted, VAPID-signed push; 410 removes the subscription; 5xx retries', async () => {
  const push = await fakePushService((path) => (path === '/gone' ? 410 : path === '/flaky' ? 503 : 201));
  try {
    const f = await publish({slug: 'push-live', name: 'Push Live', shortName: 'PushL'});
    const ownerId = await makeLive('push-live');
    const {sql} = await database();
    const owner = browserKeys();
    await sql`insert into app.push_subscriptions (tenant_id, audience, user_id, endpoint, p256dh, auth_secret)
              values (${f.tenantId}, 'owner', ${ownerId}, ${`${push.origin}/owner`}, ${owner.p256dh}, ${owner.auth})`;

    const start = await localMoment(TZ, 3, '10:00');
    const res = await pub(request('public-api', '/tenant/push-live/bookings', {
      method: 'POST', ip: '100.70.0.1',
      json: {serviceId: f.service.wash, startAt: start, name: 'Клиент Пуш', phone: '+79994445566', consent: true, idempotencyKey: crypto.randomUUID()},
    }));
    const {booking, token} = await res.json();

    const summary = await (await dispatch()).json();
    assertEquals(summary.sent, 1);
    const got = push.received.find((r) => r.path === '/owner')!;
    assertEquals(got.headers.get('content-encoding'), 'aes128gcm');
    assert(Number(got.headers.get('ttl')) > 0);
    const authz = got.headers.get('authorization')!;
    const m = authz.match(/^vapid t=([^,]+), k=(.+)$/)!;
    assertEquals(m[2], vapid.publicKey);
    const {payload: claims} = await jwtVerify(m[1]!, await vapidPublicJwk(), {audience: push.origin});
    assertEquals(claims.sub, 'mailto:ops@example.test');
    const plain = ece.decrypt(Buffer.from(got.body), {version: 'aes128gcm', privateKey: owner.ecdh, authSecret: owner.auth});
    const message = JSON.parse(plain.toString('utf8'));
    assertEquals(message.title, 'Новая запись');
    assertMatch(message.body, /Wash · .* · Клиент Пуш/);
    assertEquals(message.url, `/s/push-live/owner/bookings/${booking.id}`);
    const [job] = await sql`select status, sent_count from app.notification_jobs where booking_id = ${booking.id} and kind = 'owner_new_booking'`;
    assertEquals(job, {status: 'sent', sent_count: 1});

    // Client subscribes on a device whose push endpoint is gone (410).
    const gone = browserKeys();
    await pub(request('public-api', '/tenant/push-live/booking/push', {method: 'POST', ip: '100.70.0.2', json: {token, subscription: {endpoint: `${push.origin}/gone`, keys: {p256dh: gone.p256dh, auth: gone.auth}}}}));
    await sql`update app.notification_jobs set due_at = now() - interval '1 second' where booking_id = ${booking.id} and kind = 'client_reminder'`;
    const s2 = await (await dispatch()).json();
    assert(s2.failed >= 1);
    const left = await sql`select 1 from app.push_subscriptions where endpoint = ${`${push.origin}/gone`}`;
    assertEquals(left.length, 0);

    // Transient push-service failure: the job is retried later, not lost.
    const flaky = browserKeys();
    await sql`insert into app.push_subscriptions (tenant_id, audience, booking_id, endpoint, p256dh, auth_secret)
              values (${f.tenantId}, 'client', ${booking.id}, ${`${push.origin}/flaky`}, ${flaky.p256dh}, ${flaky.auth})`;
    const [retryJob] = await sql`select id from app.notification_jobs where booking_id = ${booking.id} and kind = 'client_reminder' and status = 'failed' limit 1`;
    await sql`update app.notification_jobs set status = 'pending', due_at = now() - interval '1 second', attempts = 0, finished_at = null where id = ${retryJob!.id}`;
    const s3 = await (await dispatch()).json();
    assertEquals(s3.retried, 1);
    const [after] = await sql`select status, attempts, due_at > now() as later from app.notification_jobs where id = ${retryJob!.id}`;
    assertEquals(after, {status: 'pending', attempts: 1, later: true});
  } finally {
    await push.close();
  }
});

test('preview studio: jobs are suppressed and never sent', async () => {
  const push = await fakePushService();
  try {
    const f = await publish({slug: 'push-preview', name: 'Push Preview', shortName: 'PushP'});
    const {sql} = await database();
    const start = await localMoment(TZ, 3, '12:00');
    const res = await pub(request('public-api', '/tenant/push-preview/bookings', {
      method: 'POST', ip: '100.70.1.1',
      json: {serviceId: f.service.wash, startAt: start, name: 'Демо', phone: '+79994445577', consent: true, idempotencyKey: crypto.randomUUID()},
    }));
    const {booking} = await res.json();
    const jobs = await sql`select status from app.notification_jobs where booking_id = ${booking.id}`;
    assert(jobs.length > 0 && jobs.every((j) => j.status === 'suppressed'));
    await dispatch();
    assertEquals(push.received.length, 0);
  } finally {
    await push.close();
  }
});
