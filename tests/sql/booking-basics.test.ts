import {randomUUID} from 'node:crypto';
import {fixtureConfig} from '../fixtures/business.ts';
import {openTestDb, publish, catalog, localMoment, localDate, publicBook, newToken, asAnon, expectDbError, type TestDb} from './harness.ts';

let db: TestDb;
let tenantId: string;
let ids: Awaited<ReturnType<typeof catalog>>;
const TZ = 'Europe/Moscow';

beforeAll(async () => {
  db = await openTestDb();
  const r = await publish(db.sql, fixtureConfig());
  tenantId = r.tenantId;
  ids = await catalog(db.sql, tenantId);
});
afterAll(async () => db?.close());

describe('availability', () => {
  it('generates reception moments from working hours in the tenant timezone', async () => {
    const day = await localDate(db.sql, TZ, 3);
    const r = await asAnon(db.sql, async (tx) => {
      const [row] = await tx`select app.public_availability('alpha', ${ids.service.wash!}, ${day}::date, ${day}::date) as r`;
      return row!.r;
    });
    const slots = r.days[0].slots as {time: string}[];
    expect(r.timezone).toBe(TZ);
    expect(slots[0]!.time).toBe('09:00');
    // same_day 60 min service must end by 21:00 -> last start 20:00
    expect(slots.at(-1)!.time).toBe('20:00');
    expect(slots).toHaveLength(23);
  });

  it('multi_day service may start until closing and spans nights', async () => {
    const day = await localDate(db.sql, TZ, 3);
    const r = await asAnon(db.sql, async (tx) => {
      const [row] = await tx`select app.public_availability('alpha', ${ids.service.coating!}, ${day}::date, ${day}::date) as r`;
      return row!.r;
    });
    const slots = r.days[0].slots as {time: string}[];
    expect(slots.at(-1)!.time).toBe('20:30');
  });
});

describe('create booking', () => {
  it('books through the public API with server-side price and duration', async () => {
    const start = await localMoment(db.sql, TZ, 4, '10:00');
    const {hash} = newToken();
    const r = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, tokenHash: hash});
    expect(r.replayed).toBe(false);
    expect(r.booking.status).toBe('scheduled');
    expect(Number(r.booking.price.amount)).toBe(2000);
    const [occ] = await db.sql`select lower(during) as l, upper(during) as u from app.resource_occupancies where booking_id = ${r.booking.id}`;
    expect(occ!.l.toISOString()).toBe(start.toISOString());
    // 60 min work + 15 min buffer
    expect((occ!.u.getTime() - occ!.l.getTime()) / 60000).toBe(75);
    const [acc] = await db.sql`select token_hash from app.booking_access where booking_id = ${r.booking.id}`;
    expect(Buffer.compare(acc!.token_hash, hash)).toBe(0);
  });

  it('rejects a start that is not a reception moment', async () => {
    const start = await localMoment(db.sql, TZ, 4, '10:10');
    await expectDbError(publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start}), 'slot_unavailable');
    const late = await localMoment(db.sql, TZ, 4, '20:30');
    await expectDbError(publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: late}), 'slot_unavailable');
  });

  it('rejects unknown tenant and a service of another tenant', async () => {
    const start = await localMoment(db.sql, TZ, 4, '12:00');
    await expectDbError(publicBook(db.sql, {slug: 'nope', serviceId: ids.service.wash!, start}), 'tenant_unavailable');
    await expectDbError(publicBook(db.sql, {slug: 'alpha', serviceId: randomUUID(), start}), 'not_found');
  });
});
