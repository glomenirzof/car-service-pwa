// Historical price, payments, and statistics that keep visits, completed
// orders, received payments and expected (future) value apart.
import {randomUUID} from 'node:crypto';
import {fixtureConfig} from '../fixtures/business.ts';
import {openTestDb, publish, catalog, localMoment, localDate, publicBook, asUser, createOwner, expectDbError, type TestDb} from './harness.ts';

let db: TestDb;
let tenantId: string;
let ids: Awaited<ReturnType<typeof catalog>>;
let owner: string;
const TZ = 'Europe/Moscow';

beforeAll(async () => {
  db = await openTestDb();
  tenantId = (await publish(db.sql, fixtureConfig())).tenantId;
  ids = await catalog(db.sql, tenantId);
  owner = await createOwner(db.sql, 'alpha');
});
afterAll(async () => db?.close());

it('keeps the price of existing bookings when the config price changes', async () => {
  const start = await localMoment(db.sql, TZ, 5, '10:00');
  const old = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, phone: '+79996660001'});
  expect(Number(old.booking.price.amount)).toBe(2000);

  const cfg = fixtureConfig();
  cfg.services[0]!.price.amount = 2600;
  const r = await publish(db.sql, cfg);
  expect(r.services.priceChanges).toBe(1);

  const fresh = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: await localMoment(db.sql, TZ, 5, '12:00'), phone: '+79996660002'});
  expect(Number(fresh.booking.price.amount)).toBe(2600);
  const [kept] = await db.sql`select price_amount from app.bookings where id = ${old.booking.id}`;
  expect(Number(kept!.price_amount)).toBe(2000);
  const history = await db.sql`select price_amount from app.service_price_history where service_id = ${ids.service.wash!} order by id`;
  expect(history.map((h) => Number(h.price_amount))).toEqual([2000, 2600]);
});

it('statistics separate visits, completed orders, received payments and expected value', async () => {
  const today = await localDate(db.sql, TZ, 0);
  // Three future bookings; the owner then records what actually happened today.
  const bookings: string[] = [];
  for (const phone of ['+79997770002', '+79997770003', '+79997770004']) {
    const start = await localMoment(db.sql, TZ, 2, phone.endsWith('2') ? '10:00' : phone.endsWith('3') ? '12:00' : '14:00');
    bookings.push((await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, phone})).booking.id);
  }
  const [x, y, z] = bookings as [string, string, string];
  await asUser(db.sql, owner, async (tx) => {
    await tx`select app.owner_set_booking_status(${tenantId}, ${x}, 'arrived', null)`;
    await tx`select app.owner_set_booking_status(${tenantId}, ${x}, 'completed', 3100)`;
    await tx`select app.owner_record_payment(${tenantId}, ${x}, 1000, 'cash', now(), null, ${randomUUID()})`;
    await tx`select app.owner_record_payment(${tenantId}, ${x}, 1500, 'card', now(), null, ${randomUUID()})`;
    // y: arrived only (a visit, not a completed order)
    await tx`select app.owner_set_booking_status(${tenantId}, ${y}, 'arrived', null)`;
    // z: prepayment on a future booking — money received, not an order
    await tx`select app.owner_record_payment(${tenantId}, ${z}, 500, 'transfer', now(), 'prepay', ${randomUUID()})`;
  });

  const stats = await asUser(db.sql, owner, async (tx) =>
    (await tx`select app.owner_stats(${tenantId}, ${today}::date, ${today}::date) as r`)[0]!.r);
  expect(stats.period.timezone).toBe(TZ);
  expect(stats.visits).toBe(2);
  expect(stats.completedOrders).toEqual({count: 1, amount: 3100});
  expect(stats.paymentsReceived.amount).toBe(3000);
  expect(stats.paymentsReceived.count).toBe(3);
  expect(stats.paymentsReceived.byMethod).toEqual({cash: 1000, card: 1500, transfer: 500});
  expect(stats.outstanding).toEqual({count: 1, amount: 600});
  // Future bookings are not revenue: they are only counted in the period that contains them.
  expect(stats.upcoming.count).toBe(0);
  const future = await localDate(db.sql, TZ, 2);
  const later = await asUser(db.sql, owner, async (tx) =>
    (await tx`select app.owner_stats(${tenantId}, ${future}::date, ${future}::date) as r`)[0]!.r);
  expect(later.upcoming.count).toBeGreaterThanOrEqual(1);
  expect(later.completedOrders.amount).toBe(0);
  expect(later.paymentsReceived.amount).toBe(0);
});

it('payments are idempotent and refused for cancelled bookings', async () => {
  const start = await localMoment(db.sql, TZ, 3, '10:00');
  const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, phone: '+79997770010'});
  const key = randomUUID();
  await asUser(db.sql, owner, async (tx) => {
    const a = (await tx`select app.owner_record_payment(${tenantId}, ${b.booking.id}, 700, 'cash', now(), null, ${key}) as r`)[0]!.r;
    const again = (await tx`select app.owner_record_payment(${tenantId}, ${b.booking.id}, 700, 'cash', now(), null, ${key}) as r`)[0]!.r;
    expect(again.replayed).toBe(true);
    expect(again.payment.id).toBe(a.payment.id);
  });
  const [n] = await db.sql`select count(*)::int as n from app.payments where booking_id = ${b.booking.id}`;
  expect(n!.n).toBe(1);
  await asUser(db.sql, owner, (tx) => tx`select app.owner_cancel_booking(${tenantId}, ${b.booking.id}, 'x')`);
  await expectDbError(
    asUser(db.sql, owner, (tx) => tx`select app.owner_record_payment(${tenantId}, ${b.booking.id}, 100, 'cash', now(), null, ${randomUUID()})`),
    'invalid_state',
  );
});

it('completing early frees the rest of a multi-day occupancy', async () => {
  const start = await localMoment(db.sql, TZ, 1, '10:00');
  const b = await db.sql`select app.create_booking(${tenantId}, ${ids.service.coating!}, ${start}, 'Ceramic', '+79997770020',
    null, null, null, ${randomUUID()}, 'h', null, 'owner', null, null, false) as r`;
  const id = b[0]!.r.booking.id;
  await asUser(db.sql, owner, (tx) => tx`select app.owner_set_booking_status(${tenantId}, ${id}, 'completed', null)`);
  const [occ] = await db.sql`select upper(during) as u, lower(during) as l from app.resource_occupancies where booking_id = ${id}`;
  // Completed "now" (before the planned start) -> occupancy shrinks to the minimum
  expect(occ!.u.getTime() - occ!.l.getTime()).toBeLessThan(49 * 3600 * 1000);
  const [row] = await db.sql`select final_amount, arrived_at is not null as arrived from app.bookings where id = ${id}`;
  expect(Number(row!.final_amount)).toBe(45000);
  expect(row!.arrived).toBe(true);
});
