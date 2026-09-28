// RLS, composite tenant FKs, strict grants and token scoping.
import {randomUUID} from 'node:crypto';
import {fixtureConfig} from '../fixtures/business.ts';
import {openTestDb, publish, catalog, localMoment, publicBook, newToken, asAnon, asUser, createOwner, expectDbError, type TestDb} from './harness.ts';

let db: TestDb;
let a: {tenantId: string; ids: Awaited<ReturnType<typeof catalog>>};
let b: {tenantId: string; ids: Awaited<ReturnType<typeof catalog>>};
let ownerA: string;
let ownerB: string;
let bookingA: string;
let tokenA: ReturnType<typeof newToken>;

beforeAll(async () => {
  db = await openTestDb();
  const ra = await publish(db.sql, fixtureConfig());
  const rb = await publish(db.sql, fixtureConfig({slug: 'beta', name: 'Beta Test Studio', shortName: 'Beta', timezone: 'Asia/Yekaterinburg'}));
  a = {tenantId: ra.tenantId, ids: await catalog(db.sql, ra.tenantId)};
  b = {tenantId: rb.tenantId, ids: await catalog(db.sql, rb.tenantId)};
  ownerA = await createOwner(db.sql, 'alpha');
  ownerB = await createOwner(db.sql, 'beta');
  tokenA = newToken();
  const start = await localMoment(db.sql, 'Europe/Moscow', 5, '10:00');
  bookingA = (await publicBook(db.sql, {slug: 'alpha', serviceId: a.ids.service.wash!, start, tokenHash: tokenA.hash, name: 'Private Person', phone: '+79995550000'})).booking.id;
  await db.sql`select app.record_payment(${a.tenantId}, ${bookingA}, 500, 'cash', now(), null, ${randomUUID()})`;
});
afterAll(async () => db?.close());

describe('anon', () => {
  it.each(['tenants', 'customers', 'bookings', 'payments', 'booking_access', 'push_subscriptions', 'notification_jobs', 'resource_occupancies', 'request_ledger', 'usage_counters'])(
    'has no access to app.%s',
    async (table) => {
      await expectDbError(asAnon(db.sql, (tx) => tx.unsafe(`select * from app.${table} limit 1`)), 'permission denied');
    },
  );

  it('cannot execute owner, worker or pipeline functions', async () => {
    await expectDbError(asAnon(db.sql, (tx) => tx`select app.owner_stats(${a.tenantId}, current_date, current_date)`), 'permission denied');
    await expectDbError(asAnon(db.sql, (tx) => tx`select app.claim_notification_jobs('x', 1, 10)`), 'permission denied');
    await expectDbError(asAnon(db.sql, (tx) => tx`select app.publish_tenant('{}'::jsonb, 'x')`), 'permission denied');
    await expectDbError(asAnon(db.sql, (tx) => tx`select app.create_booking(${a.tenantId}, ${a.ids.service.wash!}, now(), 'x', '+70000000000', null, null, null, ${randomUUID()}, 'h', null, 'owner', null, null, false)`), 'permission denied');
    await expectDbError(asAnon(db.sql, (tx) => tx`select app.usage_hit('x', 60, 1, 1)`), 'permission denied');
  });

  it('public tenant profile contains no personal data', async () => {
    const r = await asAnon(db.sql, async (tx) => (await tx`select app.public_tenant('alpha') as r`)[0]!.r);
    const text = JSON.stringify(r);
    expect(text).not.toContain('Private Person');
    expect(text).not.toContain('+79995550000');
    expect(r.services.length).toBe(2);
  });

  it('a booking token only works on its own tenant slug', async () => {
    const own = await asAnon(db.sql, async (tx) => (await tx`select app.public_get_booking('alpha', ${tokenA.hash}) as r`)[0]!.r);
    expect(own.booking.id).toBe(bookingA);
    expect(own.booking.phoneMasked).not.toContain('5550');
    await expectDbError(asAnon(db.sql, (tx) => tx`select app.public_get_booking('beta', ${tokenA.hash})`), 'not_found');
    await expectDbError(asAnon(db.sql, (tx) => tx`select app.public_get_booking('alpha', ${newToken().hash})`), 'not_found');
  });

  it('cannot book a service of tenant A through tenant B', async () => {
    const start = await localMoment(db.sql, 'Europe/Moscow', 6, '10:00');
    await expectDbError(publicBook(db.sql, {slug: 'beta', serviceId: a.ids.service.wash!, start}), 'not_found');
  });
});

describe('authenticated owners', () => {
  it('see only their own tenant rows through RLS', async () => {
    const seenByB = await asUser(db.sql, ownerB, (tx) => tx`select id from app.bookings`);
    expect(seenByB.map((r) => r.id)).not.toContain(bookingA);
    const seenByA = await asUser(db.sql, ownerA, (tx) => tx`select id from app.bookings`);
    expect(seenByA.map((r) => r.id)).toContain(bookingA);
    const paymentsB = await asUser(db.sql, ownerB, (tx) => tx`select * from app.payments`);
    expect(paymentsB).toHaveLength(0);
    const customersB = await asUser(db.sql, ownerB, (tx) => tx`select * from app.customers`);
    expect(customersB).toHaveLength(0);
    const tenantsB = await asUser(db.sql, ownerB, (tx) => tx`select slug from app.tenants`);
    expect(tenantsB.map((r) => r.slug)).toEqual(['beta']);
  });

  it('never see token hashes, the ledger, push endpoints or the outbox', async () => {
    for (const table of ['booking_access', 'request_ledger', 'push_subscriptions', 'notification_jobs', 'usage_counters']) {
      await expectDbError(asUser(db.sql, ownerA, (tx) => tx.unsafe(`select * from app.${table}`)), 'permission denied');
    }
  });

  it('cannot read or mutate another tenant through owner functions', async () => {
    await expectDbError(asUser(db.sql, ownerB, (tx) => tx`select app.owner_booking(${a.tenantId}, ${bookingA})`), 'forbidden');
    await expectDbError(asUser(db.sql, ownerB, (tx) => tx`select app.owner_stats(${a.tenantId}, current_date, current_date)`), 'forbidden');
    await expectDbError(asUser(db.sql, ownerB, (tx) => tx`select app.owner_cancel_booking(${a.tenantId}, ${bookingA}, 'x')`), 'forbidden');
    // Passing own tenant id with a foreign booking id finds nothing
    await expectDbError(asUser(db.sql, ownerB, (tx) => tx`select app.owner_cancel_booking(${b.tenantId}, ${bookingA}, 'x')`), 'not_found');
    await expectDbError(asUser(db.sql, ownerB, (tx) => tx`select app.owner_block_resource(${b.tenantId}, ${a.ids.resource['box-a']!}, now() + interval '1 day', now() + interval '2 days', 'x')`), 'not_found');
    const [ctx] = await asUser(db.sql, ownerA, (tx) => tx`select app.owner_context() as r`);
    expect(ctx!.r.map((t: {slug: string}) => t.slug)).toEqual(['alpha']);
  });

  it('cannot insert or update tables directly', async () => {
    await expectDbError(asUser(db.sql, ownerA, (tx) => tx`update app.bookings set price_amount = 1 where id = ${bookingA}`), 'permission denied');
    await expectDbError(asUser(db.sql, ownerA, (tx) => tx`insert into app.payments (tenant_id, booking_id, amount, method) values (${a.tenantId}, ${bookingA}, 1, 'cash')`), 'permission denied');
  });

  it('unauthenticated calls to owner functions are refused', async () => {
    await expectDbError(
      db.sql.begin(async (tx) => {
        await tx`set local role authenticated`;
        return tx`select app.owner_stats(${a.tenantId}, current_date, current_date)`;
      }),
      'unauthenticated',
    );
  });
});

describe('composite tenant foreign keys', () => {
  it('reject a booking of tenant B that points at a resource of tenant A', async () => {
    const [cust] = await db.sql`insert into app.customers (tenant_id, name, phone) values (${b.tenantId}, 'x', '+70000000009') returning id`;
    await expectDbError(
      db.sql`insert into app.bookings (tenant_id, service_id, resource_id, customer_id, customer_name, start_at, end_at, occupied_until,
               service_name, duration_minutes, buffer_minutes, price_amount, currency)
             values (${b.tenantId}, ${b.ids.service.wash!}, ${a.ids.resource['box-a']!}, ${cust!.id}, 'x', now(), now() + interval '1h', now() + interval '1h',
               'x', 60, 0, 1, 'RUB')`,
      'foreign key',
    );
    await expectDbError(
      db.sql`insert into app.resource_occupancies (tenant_id, resource_id, kind, during)
             values (${b.tenantId}, ${a.ids.resource['box-a']!}, 'block', tstzrange(now(), now() + interval '1h'))`,
      'foreign key',
    );
  });
});
