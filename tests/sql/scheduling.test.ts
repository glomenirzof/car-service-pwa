// Two resources, multi-day occupancy with buffer, blocks, exceptions,
// timezone date boundaries and DST.
import {fixtureConfig} from '../fixtures/business.ts';
import {openTestDb, publish, catalog, localMoment, localDate, publicBook, asAnon, expectDbError, type TestDb} from './harness.ts';

let db: TestDb;
let tenantId: string;
let ids: Awaited<ReturnType<typeof catalog>>;
const TZ = 'Europe/Moscow';

async function slots(serviceId: string, day: string, slug = 'alpha') {
  return asAnon(db.sql, async (tx) => {
    const [row] = await tx`select app.public_availability(${slug}, ${serviceId}, ${day}::date, ${day}::date) as r`;
    return (row!.r.days[0].slots as {time: string; freeResources: number}[]);
  });
}

beforeAll(async () => {
  db = await openTestDb();
  const r = await publish(db.sql, fixtureConfig());
  tenantId = r.tenantId;
  ids = await catalog(db.sql, tenantId);
});
afterAll(async () => db?.close());

it('a slot stays available while at least one of two suitable resources is free', async () => {
  const day = await localDate(db.sql, TZ, 8);
  const start = await localMoment(db.sql, TZ, 8, '10:00');
  await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, phone: '+79991110001'});
  let s = await slots(ids.service.wash!, day);
  expect(s.find((x) => x.time === '10:00')!.freeResources).toBe(1);
  await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, phone: '+79991110002'});
  s = await slots(ids.service.wash!, day);
  expect(s.find((x) => x.time === '10:00')).toBeUndefined();
  // Buffer: 60 min + 15 min buffer -> 11:00 still overlaps [10:00, 11:15)
  expect(s.find((x) => x.time === '11:00')).toBeUndefined();
  expect(s.find((x) => x.time === '11:30')!.freeResources).toBe(2);
  // Earlier start whose range would run into 10:00 is gone too (09:30 + 75min)
  expect(s.find((x) => x.time === '09:30')).toBeUndefined();
  expect(s.find((x) => x.time === '09:00')).toBeUndefined(); // 09:00+75 = 10:15 > 10:00
});

it('multi-day service occupies the resource continuously across nights including buffer', async () => {
  const start = await localMoment(db.sql, TZ, 10, '18:00');
  const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.coating!, start, phone: '+79991110003'});
  const [occ] = await db.sql`select lower(during) l, upper(during) u from app.resource_occupancies where booking_id = ${b.booking.id}`;
  expect((occ!.u.getTime() - occ!.l.getTime()) / 3600000).toBe(49); // 48h work + 1h buffer
  // Next day, the only coating resource is still busy all day
  expect(await slots(ids.service.coating!, await localDate(db.sql, TZ, 11))).toHaveLength(0);
  // Day after: busy until 19:00 (18:00 + 49h) -> first free start 19:00
  const d12 = await slots(ids.service.coating!, await localDate(db.sql, TZ, 12));
  expect(d12[0]!.time).toBe('19:00');
  // The wash boxes are unaffected (different capability)
  expect((await slots(ids.service.wash!, await localDate(db.sql, TZ, 11))).length).toBeGreaterThan(0);
});

it('owner block uses the same table: blocks slots and refuses to overlap a booking', async () => {
  const day = await localDate(db.sql, TZ, 13);
  const from = await localMoment(db.sql, TZ, 13, '09:00');
  const to = await localMoment(db.sql, TZ, 13, '21:00');
  const [blockRow] = await db.sql`select app.block_resource(${tenantId}, ${ids.resource['box-a']!}, ${from}, ${to}, 'repair') as r`;
  const block = blockRow!.r as {id: string};
  const s = await slots(ids.service.wash!, day);
  expect(s.every((x) => x.freeResources === 1)).toBe(true);
  const start = await localMoment(db.sql, TZ, 13, '12:00');
  const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, phone: '+79991110004'});
  const [res] = await db.sql`select resource_id from app.bookings where id = ${b.booking.id}`;
  expect(res!.resource_id).toBe(ids.resource['box-b']);
  // Blocking box-b over the booking must fail with conflict details
  const err = await expectDbError(
    db.sql`select app.block_resource(${tenantId}, ${ids.resource['box-b']!}, ${from}, ${to}, 'x')`,
    'conflict',
  );
  expect(JSON.parse(err.detail!)[0].bookingId).toBe(b.booking.id);
  // Unblocking restores both resources
  await db.sql`select app.unblock_resource(${tenantId}, ${block.id})`;
  const after = await slots(ids.service.wash!, day);
  expect(after.find((x) => x.time === '09:00')!.freeResources).toBe(2);
});

it('closed-day exception and owner exception override weekly hours', async () => {
  const cfg = fixtureConfig({
    slug: 'alpha',
    exceptions: [{date: await localDate(db.sql, TZ, 14), hours: [], note: 'Holiday'}],
  });
  await publish(db.sql, cfg);
  expect(await slots(ids.service.wash!, await localDate(db.sql, TZ, 14))).toHaveLength(0);
  // Owner opens the holiday for a short window: owner rows win over config rows
  await db.sql`insert into app.schedule_exceptions (tenant_id, on_date, opens, closes, source)
    values (${tenantId}, ${await localDate(db.sql, TZ, 14)}, '12:00', '14:00', 'owner')`;
  const s = await slots(ids.service.wash!, await localDate(db.sql, TZ, 14));
  expect(s.map((x) => x.time)).toEqual(['12:00', '12:30', '13:00']);
});

it('local date boundaries: an early-morning slot in UTC+5 belongs to the local date', async () => {
  const east = fixtureConfig({
    slug: 'east',
    timezone: 'Asia/Yekaterinburg',
    workingHours: {
      mon: [['02:00', '06:00']], tue: [['02:00', '06:00']], wed: [['02:00', '06:00']], thu: [['02:00', '06:00']],
      fri: [['02:00', '06:00']], sat: [['02:00', '06:00']], sun: [['02:00', '06:00']],
    },
  });
  const r = await publish(db.sql, east);
  const eastIds = await catalog(db.sql, r.tenantId);
  const day = await localDate(db.sql, 'Asia/Yekaterinburg', 4);
  const s = await asAnon(db.sql, async (tx) => {
    const [row] = await tx`select app.public_availability('east', ${eastIds.service.wash!}, ${day}::date, ${day}::date) as r`;
    return row!.r.days[0].slots as {time: string; startAt: string}[];
  });
  expect(s[0]!.time).toBe('02:00');
  // 02:00 in Yekaterinburg is 21:00 UTC of the previous calendar day
  expect(new Date(s[0]!.startAt).getUTCHours()).toBe(21);
  expect(s.at(-1)!.time).toBe('05:00');
});

it('DST: reception moments follow the wall clock on a spring-forward day', async () => {
  // Europe/Berlin switches 02:00 -> 03:00 on 2027-03-28. Pure function of the date.
  const berlin = fixtureConfig({
    slug: 'berlin',
    timezone: 'Europe/Berlin',
    workingHours: {
      mon: [['01:00', '05:00']], tue: [['01:00', '05:00']], wed: [['01:00', '05:00']], thu: [['01:00', '05:00']],
      fri: [['01:00', '05:00']], sat: [['01:00', '05:00']], sun: [['01:00', '05:00']],
    },
    services: [{key: 'wash', name: 'Wash', category: 'Wash', durationMinutes: 30, bufferMinutes: 0, capability: 'wash', price: {amount: 1, from: false}}],
  });
  const r = await publish(db.sql, berlin);
  const bIds = await catalog(db.sql, r.tenantId);
  const rows = await db.sql`
    select to_char(start_at at time zone 'Europe/Berlin', 'HH24:MI') as t
      from app.available_starts(${r.tenantId}, ${bIds.service.wash!}, '2027-03-28', '2027-03-28', null, false)`;
  expect(rows.map((x) => x.t)).toEqual(['01:00', '01:30', '03:00', '03:30', '04:00', '04:30']);
  const [w] = await db.sql`select closes_at - opens_at as len from app.day_intervals(${r.tenantId}, '2027-03-28')`;
  expect(w!.len).toBe('03:00:00');
});
