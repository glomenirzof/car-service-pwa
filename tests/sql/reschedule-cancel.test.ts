import {randomUUID} from 'node:crypto';
import {fixtureConfig} from '../fixtures/business.ts';
import {openTestDb, publish, catalog, localMoment, publicBook, newToken, asAnon, createOwner, expectDbError, type TestDb} from './harness.ts';

let db: TestDb;
let tenantId: string;
let ids: Awaited<ReturnType<typeof catalog>>;
const TZ = 'Europe/Moscow';

beforeAll(async () => {
  db = await openTestDb();
  tenantId = (await publish(db.sql, fixtureConfig())).tenantId;
  ids = await catalog(db.sql, tenantId);
  // Live tenant: bookings are real and notifications are pending, not suppressed.
  await createOwner(db.sql, 'alpha');
  await db.sql`select app.activate_tenant('alpha')`;
});
afterAll(async () => db?.close());

const reschedule = (hash: Buffer, start: Date, key = randomUUID()) =>
  asAnon(db.sql, async (tx) => (await tx`select app.public_reschedule_booking('alpha', ${hash}, ${start}, ${key}) as r`)[0]!.r);

it('client reschedules by token, keeps the same box, gets new reminders', async () => {
  const t = newToken();
  const start = await localMoment(db.sql, TZ, 5, '10:00');
  const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, tokenHash: t.hash});
  const [before] = await db.sql`select resource_id from app.bookings where id = ${b.booking.id}`;
  const next = await localMoment(db.sql, TZ, 5, '14:00');
  const r = await reschedule(t.hash, next);
  expect(r.changed).toBe(true);
  expect(new Date(r.booking.startAt).toISOString()).toBe(next.toISOString());
  const [after] = await db.sql`select resource_id, reschedule_count, version from app.bookings where id = ${b.booking.id}`;
  expect(after!.resource_id).toBe(before!.resource_id);
  expect(after!.reschedule_count).toBe(1);
  const occ = await db.sql`select lower(during) l from app.resource_occupancies where booking_id = ${b.booking.id}`;
  expect(occ).toHaveLength(1);
  expect(occ[0]!.l.toISOString()).toBe(next.toISOString());
});

it('a failed reschedule keeps the original booking and occupancy intact', async () => {
  const t = newToken();
  const start = await localMoment(db.sql, TZ, 6, '10:00');
  const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, tokenHash: t.hash});
  // Fill 16:00 on both boxes
  const busy = await localMoment(db.sql, TZ, 6, '16:00');
  await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: busy, phone: '+79992220001'});
  await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: busy, phone: '+79992220002'});
  const snapshot = await db.sql`select b.start_at, b.resource_id, b.version, o.during
    from app.bookings b join app.resource_occupancies o on o.booking_id = b.id where b.id = ${b.booking.id}`;
  await expectDbError(reschedule(t.hash, busy), 'slot_unavailable');
  const after = await db.sql`select b.start_at, b.resource_id, b.version, o.during
    from app.bookings b join app.resource_occupancies o on o.booking_id = b.id where b.id = ${b.booking.id}`;
  expect(after).toEqual(snapshot);
  // The failed attempt did not burn its idempotency key
  const key = randomUUID();
  await expectDbError(reschedule(t.hash, busy, key), 'slot_unavailable');
  const free = await localMoment(db.sql, TZ, 6, '18:00');
  expect((await reschedule(t.hash, free, key)).changed).toBe(true);
});

it('reschedule can move onto its own old range (shift by 30 minutes)', async () => {
  const t = newToken();
  const start = await localMoment(db.sql, TZ, 7, '10:00');
  await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, tokenHash: t.hash});
  const shifted = await localMoment(db.sql, TZ, 7, '10:30');
  expect((await reschedule(t.hash, shifted)).changed).toBe(true);
});

it('reschedule is idempotent and a reused key with another time is refused', async () => {
  const t = newToken();
  const start = await localMoment(db.sql, TZ, 8, '10:00');
  await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, tokenHash: t.hash});
  const key = randomUUID();
  const next = await localMoment(db.sql, TZ, 8, '12:00');
  const first = await reschedule(t.hash, next, key);
  const again = await reschedule(t.hash, next, key);
  expect(again.replayed).toBe(true);
  expect(again.booking.id).toBe(first.booking.id);
  const [row] = await db.sql`select reschedule_count from app.bookings where id = ${first.booking.id}`;
  expect(row!.reschedule_count).toBe(1);
  await expectDbError(reschedule(t.hash, await localMoment(db.sql, TZ, 8, '13:00'), key), 'idempotency_conflict');
});

it('client cannot change a booking inside the change window; owner can', async () => {
  // A studio that only lets clients change bookings up to 7 days ahead.
  const strict = fixtureConfig({slug: 'strict', booking: {slotStepMinutes: 30, minLeadMinutes: 60, horizonDays: 30, clientChangeUntilHours: 168, reminderMinutesBefore: [120]}});
  const r = await publish(db.sql, strict);
  const strictIds = await catalog(db.sql, r.tenantId);
  const t = newToken();
  const start = await localMoment(db.sql, TZ, 3, '10:00');
  const b = await publicBook(db.sql, {slug: 'strict', serviceId: strictIds.service.wash!, start, tokenHash: t.hash});
  const view = await asAnon(db.sql, async (tx) => (await tx`select app.public_get_booking('strict', ${t.hash}) as r`)[0]!.r);
  expect(view.booking.canChange).toBe(false);
  const later = await localMoment(db.sql, TZ, 4, '10:00');
  await expectDbError(
    asAnon(db.sql, (tx) => tx`select app.public_reschedule_booking('strict', ${t.hash}, ${later}, ${randomUUID()})`),
    'too_late',
  );
  await expectDbError(asAnon(db.sql, (tx) => tx`select app.public_cancel_booking('strict', ${t.hash}, 'plans changed')`), 'too_late');
  const [c] = await db.sql`select app.cancel_booking(${r.tenantId}, ${b.booking.id}, 'owner', null, 'owner cancelled') as r`;
  expect(c!.r.booking.status).toBe('cancelled');
});

it('cancel frees the resource, cancels reminders and is idempotent', async () => {
  const t = newToken();
  const start = await localMoment(db.sql, TZ, 9, '15:00');
  const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start, tokenHash: t.hash});
  const cancel = () => asAnon(db.sql, async (tx) => (await tx`select app.public_cancel_booking('alpha', ${t.hash}, 'sick') as r`)[0]!.r);
  const first = await cancel();
  expect(first.changed).toBe(true);
  expect(first.booking.status).toBe('cancelled');
  expect((await cancel()).changed).toBe(false);
  const occ = await db.sql`select 1 from app.resource_occupancies where booking_id = ${b.booking.id}`;
  expect(occ).toHaveLength(0);
  const jobs = await db.sql`select kind, status from app.notification_jobs where booking_id = ${b.booking.id} order by id`;
  const reminders = jobs.filter((j) => j.kind === 'client_reminder');
  expect(reminders.length).toBe(2);
  expect(reminders.every((j) => j.status === 'cancelled')).toBe(true);
  expect(jobs.find((j) => j.kind === 'owner_booking_cancelled')?.status).toBe('pending');
  // Reschedule of a cancelled booking is refused
  await expectDbError(reschedule(t.hash, await localMoment(db.sql, TZ, 9, '17:00')), 'invalid_state');
});
