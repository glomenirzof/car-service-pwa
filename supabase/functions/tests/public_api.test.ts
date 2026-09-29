import {assert, assertEquals, assertMatch, assertNotEquals} from '@std/assert';
import {handler} from '../public-api/handler.ts';
import {database, localDate, localMoment, publish, request, test} from './helpers.ts';

const fx = publish({slug: 'pub-alpha'});
const TZ = 'Europe/Moscow';

async function book(body: Record<string, unknown>, ip = `198.51.100.${Math.floor(Math.random() * 250)}`, headers?: HeadersInit) {
  const f = await fx;
  return handler(
    request('public-api', '/tenant/pub-alpha/bookings', {
      method: 'POST',
      ip,
      headers,
      json: {serviceId: f.service.wash, name: 'Иван', phone: '8 999 123-45-67', consent: true, idempotencyKey: crypto.randomUUID(), ...body},
    }),
  );
}

test('tenant profile is public and has no personal data', async () => {
  await fx;
  const res = await handler(request('public-api', '/tenant/pub-alpha'));
  assertEquals(res.status, 200);
  const {tenant} = await res.json();
  assertEquals(tenant.slug, 'pub-alpha');
  assertEquals(tenant.services.length, 2);
  assertEquals((await handler(request('public-api', '/tenant/nope'))).status, 404);
});

test('availability returns slots in the studio timezone', async () => {
  const f = await fx;
  const day = await localDate(TZ, 3);
  const res = await handler(request('public-api', `/tenant/pub-alpha/availability?service=${f.service.wash}&from=${day}&to=${day}`));
  assertEquals(res.status, 200);
  const {availability} = await res.json();
  assertEquals(availability.days[0].slots[0].time, '09:00');
  const bad = await handler(request('public-api', `/tenant/pub-alpha/availability?service=${f.service.wash}&from=${day}&to=2099-01-01`));
  assertEquals(bad.status, 400);
});

test('booking: 201 with token; retry with the same key returns the same booking and the same token', async () => {
  const start = await localMoment(TZ, 4, '10:00');
  const key = crypto.randomUUID();
  const first = await book({startAt: start, idempotencyKey: key});
  assertEquals(first.status, 201);
  const a = await first.json();
  assertMatch(a.token, /^[A-Za-z0-9_-]{43}$/);
  assertEquals(a.booking.status, 'scheduled');
  assertEquals(a.booking.price.amount, 2000); // server price, client never sent one
  const again = await book({startAt: start, idempotencyKey: key});
  assertEquals(again.status, 200);
  const b = await again.json();
  assertEquals(b.booking.id, a.booking.id);
  assertEquals(b.token, a.token);
  assertEquals(b.replayed, true);
  // The database keeps only the hash of the token.
  const {sql} = await database();
  const rows = await sql`select encode(token_hash, 'hex') as h from app.booking_access where booking_id = ${a.booking.id}`;
  assertNotEquals(rows[0]!.h, a.token);
  assertEquals(rows[0]!.h.length, 64);
});

test('booking body cannot set price, tenant or duration; invalid input is 400', async () => {
  const f = await fx;
  const start = await localMoment(TZ, 4, '12:00');
  const res = await book({startAt: start, price: 1, tenantId: f.tenantId, durationMinutes: 1});
  assertEquals(res.status, 201);
  const {booking} = await res.json();
  assertEquals(booking.price.amount, 2000);
  assertEquals(booking.service.durationMinutes, 60);
  assertEquals((await book({startAt: start, phone: '12'})).status, 400);
  assertEquals((await book({startAt: start, consent: false})).status, 400);
});

test('token flow: view, reschedule, cancel; token is scoped to its studio', async () => {
  await publish({slug: 'pub-beta', name: 'Beta Pub', shortName: 'Beta'});
  const start = await localMoment(TZ, 5, '10:00');
  const {token, booking} = await (await book({startAt: start})).json();
  const get = await handler(request('public-api', '/tenant/pub-alpha/booking/get', {method: 'POST', json: {token}}));
  assertEquals(get.status, 200);
  assertEquals((await get.json()).booking.id, booking.id);
  const foreign = await handler(request('public-api', '/tenant/pub-beta/booking/get', {method: 'POST', json: {token}}));
  assertEquals(foreign.status, 404);

  const newStart = await localMoment(TZ, 5, '15:00');
  const moved = await handler(request('public-api', '/tenant/pub-alpha/booking/reschedule', {method: 'POST', json: {token, startAt: newStart, idempotencyKey: crypto.randomUUID()}}));
  assertEquals(moved.status, 200);
  assertEquals(new Date((await moved.json()).booking.startAt).toISOString(), newStart);

  const cancelled = await handler(request('public-api', '/tenant/pub-alpha/booking/cancel', {method: 'POST', json: {token, reason: 'не успеваю'}}));
  assertEquals((await cancelled.json()).booking.status, 'cancelled');
});

test('slot taken returns 409 with a stable code', async () => {
  const start = await localMoment(TZ, 6, '10:00');
  assertEquals((await book({startAt: start, phone: '+79990000011'})).status, 201);
  assertEquals((await book({startAt: start, phone: '+79990000012'})).status, 201);
  const third = await book({startAt: start, phone: '+79990000013'});
  assertEquals(third.status, 409);
  assertEquals((await third.json()).error.code, 'slot_unavailable');
});

test('booking creation is rate limited per client by a shared DB counter', async () => {
  Deno.env.set('RL_BOOKINGS_PER_10MIN', '2');
  try {
    const ip = `192.0.2.${Math.floor(Math.random() * 200)}`;
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = await localMoment(TZ, 7, `${10 + i}:00`);
      codes.push((await book({startAt: start, phone: `+7999111000${i}`}, ip)).status);
    }
    assertEquals(codes, [201, 201, 429]);
    const res = await book({startAt: await localMoment(TZ, 7, '16:00')}, ip);
    assert(res.headers.get('retry-after'));
  } finally {
    Deno.env.delete('RL_BOOKINGS_PER_10MIN');
  }
});

test('without a trusted client IP header per-client limits are skipped, not shared by everyone', async () => {
  Deno.env.set('RL_BOOKINGS_PER_10MIN', '1');
  // Only cf-connecting-ip is trusted here: the x-forwarded-for the helper sends is ignored.
  Deno.env.set('CLIENT_IP_HEADERS', 'cf-connecting-ip');
  try {
    const anonymous: number[] = [];
    for (let i = 0; i < 3; i++) {
      anonymous.push((await book({startAt: await localMoment(TZ, 9, `${10 + i}:00`), phone: `+7999222000${i}`})).status);
    }
    assertEquals(anonymous, [201, 201, 201]);

    const trusted = {'cf-connecting-ip': `192.0.2.${Math.floor(Math.random() * 200)}`};
    const limited: number[] = [];
    for (let i = 0; i < 2; i++) {
      limited.push((await book({startAt: await localMoment(TZ, 10, `${10 + i}:00`), phone: `+7999333000${i}`}, undefined, trusted)).status);
    }
    assertEquals(limited, [201, 429]);
  } finally {
    Deno.env.delete('RL_BOOKINGS_PER_10MIN');
    Deno.env.delete('CLIENT_IP_HEADERS');
  }
});
