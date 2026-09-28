import {assertEquals, assert} from '@std/assert';
import {exportJWK, generateKeyPair, SignJWT} from 'jose';
import {handler as owner} from '../owner-api/handler.ts';
import {handler as pub} from '../public-api/handler.ts';
import {createOwner, localDate, localMoment, mintJwt, publish, request, test} from './helpers.ts';

const TZ = 'Europe/Moscow';
const setup = (async () => {
  const a = await publish({slug: 'own-a', name: 'Own A', shortName: 'OwnA'});
  const b = await publish({slug: 'own-b', name: 'Own B', shortName: 'OwnB', timezone: 'Asia/Yekaterinburg'});
  const ownerA = await createOwner('own-a');
  const ownerB = await createOwner('own-b');
  return {a, b, ownerA, ownerB, tokenA: await mintJwt(ownerA), tokenB: await mintJwt(ownerB)};
})();

const auth = (token: string) => ({Authorization: `Bearer ${token}`});

test('context lists only the studios the user is a member of', async () => {
  const s = await setup;
  const res = await owner(request('owner-api', '/context', {headers: auth(s.tokenA)}));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.tenants.map((t: {slug: string}) => t.slug), ['own-a']);
});

test('no token, forged token and expired token are rejected', async () => {
  await setup;
  assertEquals((await owner(request('owner-api', '/context'))).status, 401);
  const forged = await mintJwt(crypto.randomUUID(), {secret: 'another-secret-another-secret-another!!'});
  assertEquals((await owner(request('owner-api', '/context', {headers: auth(forged)}))).status, 401);
  const expired = await mintJwt(crypto.randomUUID(), {expiresIn: '-1m'});
  assertEquals((await owner(request('owner-api', '/context', {headers: auth(expired)}))).status, 401);
  const anonRole = await mintJwt(crypto.randomUUID(), {role: 'anon'});
  assertEquals((await owner(request('owner-api', '/context', {headers: auth(anonRole)}))).status, 401);
});

test('a client booking appears in the owner schedule with contact data; other owners get 403', async () => {
  const s = await setup;
  const start = await localMoment(TZ, 3, '11:00');
  const created = await pub(
    request('public-api', '/tenant/own-a/bookings', {
      method: 'POST',
      ip: '198.18.0.1',
      json: {serviceId: s.a.service.wash, startAt: start, name: 'Пётр', phone: '+79995551122', car: 'Kia', consent: true, idempotencyKey: crypto.randomUUID()},
    }),
  );
  const {booking} = await created.json();
  const day = await localDate(TZ, 3);
  const res = await owner(request('owner-api', `/t/${s.a.tenantId}/schedule?from=${day}&to=${day}`, {headers: auth(s.tokenA)}));
  const {schedule} = await res.json();
  const row = schedule.bookings.find((b: {id: string}) => b.id === booking.id);
  assertEquals(row.phone, '+79995551122');
  assertEquals(row.customerName, 'Пётр');
  const foreign = await owner(request('owner-api', `/t/${s.a.tenantId}/schedule?from=${day}&to=${day}`, {headers: auth(s.tokenB)}));
  assertEquals(foreign.status, 403);
  const detail = await owner(request('owner-api', `/t/${s.b.tenantId}/bookings/${booking.id}`, {headers: auth(s.tokenB)}));
  assertEquals(detail.status, 404);
});

test('owner status, payment (idempotent) and stats', async () => {
  const s = await setup;
  const start = await localMoment(TZ, 2, '12:00');
  const created = await owner(
    request('owner-api', `/t/${s.a.tenantId}/bookings`, {
      method: 'POST',
      headers: auth(s.tokenA),
      json: {serviceId: s.a.service.wash, startAt: start, name: 'По телефону', phone: '+79995551133', idempotencyKey: crypto.randomUUID()},
    }),
  );
  assertEquals(created.status, 201);
  const {booking} = await created.json();
  const done = await owner(request('owner-api', `/t/${s.a.tenantId}/bookings/${booking.id}/status`, {method: 'POST', headers: auth(s.tokenA), json: {status: 'completed', finalAmount: 2500}}));
  assertEquals(done.status, 200);
  const key = crypto.randomUUID();
  const pay = () =>
    owner(request('owner-api', `/t/${s.a.tenantId}/bookings/${booking.id}/payments`, {method: 'POST', headers: auth(s.tokenA), json: {amount: 2500, method: 'card', idempotencyKey: key}}));
  assertEquals((await pay()).status, 201);
  assertEquals((await (await pay()).json()).replayed, true);
  const today = await localDate(TZ, 0);
  const stats = await (await owner(request('owner-api', `/t/${s.a.tenantId}/stats?from=${today}&to=${today}`, {headers: auth(s.tokenA)}))).json();
  assertEquals(stats.stats.completedOrders.amount, 2500);
  assertEquals(stats.stats.paymentsReceived.amount, 2500);
  assertEquals(stats.stats.period.timezone, TZ);
});

test('block conflicts are reported with details', async () => {
  const s = await setup;
  const day = await localMoment(TZ, 3, '09:00');
  const end = await localMoment(TZ, 3, '21:00');
  const block = (resourceId: string) =>
    owner(request('owner-api', `/t/${s.a.tenantId}/blocks`, {method: 'POST', headers: auth(s.tokenA), json: {resourceId, from: day, to: end, note: 'ремонт'}}));
  const results = await Promise.all([block(s.a.resource['box-a']!), block(s.a.resource['box-b']!)]);
  const statuses = results.map((r) => r.status).sort();
  assert(statuses.includes(409), `expected one conflict (the day-3 booking), got ${statuses}`);
  const conflict = results.find((r) => r.status === 409)!;
  const body = await conflict.json();
  assertEquals(body.error.code, 'conflict');
  assert(Array.isArray(body.error.detail) && body.error.detail.length >= 1);
});

test('JWKS verification (asymmetric Supabase signing keys)', async () => {
  const s = await setup;
  const {publicKey, privateKey} = await generateKeyPair('ES256');
  const jwk = {...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig'};
  const server = Deno.serve({port: 0, hostname: '127.0.0.1', onListen: () => {}}, () => Response.json({keys: [jwk]}));
  const secret = Deno.env.get('AUTH_JWT_SECRET')!;
  Deno.env.delete('AUTH_JWT_SECRET');
  Deno.env.set('AUTH_JWKS_URL', `http://127.0.0.1:${server.addr.port}/auth/v1/.well-known/jwks.json`);
  try {
    const token = await new SignJWT({role: 'authenticated'})
      .setProtectedHeader({alg: 'ES256', kid: 'test-key'})
      .setSubject(s.ownerA)
      .setAudience('authenticated')
      .setIssuer('http://auth.test/auth/v1')
      .setExpirationTime('10m')
      .sign(privateKey);
    const ok = await owner(request('owner-api', '/context', {headers: auth(token)}));
    assertEquals(ok.status, 200);
    assertEquals((await ok.json()).tenants[0].slug, 'own-a');
    // An HS256 token is not accepted when the project uses asymmetric keys.
    assertEquals((await owner(request('owner-api', '/context', {headers: auth(s.tokenA)}))).status, 401);
  } finally {
    Deno.env.set('AUTH_JWT_SECRET', secret);
    Deno.env.delete('AUTH_JWKS_URL');
    await server.shutdown();
  }
});
