// Concurrent writers against the real EXCLUDE constraint: separate connections,
// overlapping transactions, no application-level locking.
import postgres from 'postgres';
import {randomUUID} from 'node:crypto';
import {fixtureConfig} from '../fixtures/business.ts';
import {openTestDb, publish, catalog, localMoment, newToken, type TestDb} from './harness.ts';
import {adminUrl} from './env.ts';

let db: TestDb;
let ids: Awaited<ReturnType<typeof catalog>>;
const TZ = 'Europe/Moscow';

beforeAll(async () => {
  db = await openTestDb();
  const r = await publish(db.sql, fixtureConfig());
  ids = await catalog(db.sql, r.tenantId);
});
afterAll(async () => db?.close());

function bookSql(tx: postgres.TransactionSql, serviceId: string, start: Date, key = randomUUID(), phone = '+79990001111') {
  return tx`
    select app.public_create_booking('alpha', ${serviceId}, ${start}, 'Racer', ${phone}, null, null, null,
      ${key}, ${newToken().hash}) as r`;
}

async function inTx<T>(url: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const conn = postgres(url, {max: 1, onnotice: () => {}});
  try {
    return (await conn.begin(async (tx) => {
      await tx`set local role anon`;
      return fn(tx);
    })) as T;
  } finally {
    await conn.end();
  }
}

it('two resources: two parallel clients get different boxes, the third is refused', async () => {
  const start = await localMoment(db.sql, TZ, 5, '11:00');
  const url = adminUrl(db.name);
  const results = await Promise.allSettled(
    [0, 1, 2].map((i) => inTx(url, (tx) => bookSql(tx, ids.service.wash!, start, randomUUID(), `+7999000222${i}`))),
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  expect(ok).toHaveLength(2);
  expect(failed).toHaveLength(1);
  expect(String(failed[0]!.reason.message)).toContain('slot_unavailable');
  const rows = await db.sql`select resource_id from app.bookings where start_at = ${start} and status = 'scheduled'`;
  expect(new Set(rows.map((r) => r.resource_id)).size).toBe(2);
});

it('the second writer waits for the first one and then fails on the constraint', async () => {
  const start = await localMoment(db.sql, TZ, 6, '15:00');
  const url = adminUrl(db.name);
  // Occupy box-b with an owner block so only box-a is suitable.
  const blockFrom = await localMoment(db.sql, TZ, 6, '14:00');
  const blockTo = await localMoment(db.sql, TZ, 6, '18:00');
  await db.sql`select app.block_resource(${(await db.sql`select id from app.tenants where slug='alpha'`)[0]!.id},
    ${ids.resource['box-b']!}, ${blockFrom}, ${blockTo}, 'maintenance')`;

  let releaseFirst!: () => void;
  const firstHolding = new Promise<void>((r) => (releaseFirst = r));
  let firstInserted!: () => void;
  const inserted = new Promise<void>((r) => (firstInserted = r));

  const first = inTx(url, async (tx) => {
    const res = await bookSql(tx, ids.service.wash!, start);
    firstInserted();
    await firstHolding; // keep the transaction open
    return res;
  });
  await inserted;
  const t0 = Date.now();
  // Settle immediately so the expected rejection is never "unhandled" for a tick.
  const second = inTx(url, (tx) => bookSql(tx, ids.service.wash!, start)).then(
    () => new Error('second writer unexpectedly succeeded'),
    (error: Error) => error,
  );
  setTimeout(releaseFirst, 400);
  await expect(first).resolves.toBeTruthy();
  const err = await second;
  expect(err.message).toBe('slot_unavailable');
  expect(Date.now() - t0).toBeGreaterThanOrEqual(350); // it really blocked on the first writer
  const count = await db.sql`select count(*)::int as n from app.bookings where start_at = ${start}`;
  expect(count[0]!.n).toBe(1);
});

it('concurrent retries with the same idempotency key create exactly one booking', async () => {
  const start = await localMoment(db.sql, TZ, 7, '12:00');
  const url = adminUrl(db.name);
  const key = randomUUID();
  const token = newToken();
  const call = () =>
    inTx(url, (tx) => tx`
      select app.public_create_booking('alpha', ${ids.service.wash!}, ${start}, 'Retry', '+79990003333', null, null, null,
        ${key}, ${token.hash}) as r`);
  const results = await Promise.all([call(), call(), call()]);
  const bookings = results.map((r) => r[0]!.r.booking.id as string);
  expect(new Set(bookings).size).toBe(1);
  expect(results.filter((r) => r[0]!.r.replayed === false)).toHaveLength(1);
  const n = await db.sql`select count(*)::int as n from app.bookings where customer_name = 'Retry'`;
  expect(n[0]!.n).toBe(1);
});
