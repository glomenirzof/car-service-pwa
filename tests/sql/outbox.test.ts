// Notification outbox: enqueue in the booking transaction, dedupe, lease,
// SKIP LOCKED claiming, stale detection after reschedule/cancel, retries,
// removal of gone subscriptions, and suppression in preview.
import {randomUUID} from 'node:crypto';
import {fixtureConfig} from '../fixtures/business.ts';
import {openTestDb, publish, catalog, localMoment, publicBook, newToken, asAnon, createOwner, type TestDb} from './harness.ts';

let db: TestDb;
let tenantId: string;
let ids: Awaited<ReturnType<typeof catalog>>;
let owner: string;
const TZ = 'Europe/Moscow';

async function subscribeClient(hash: Buffer, endpoint = `https://push.example.test/${randomUUID()}`) {
  await asAnon(db.sql, (tx) => tx`select app.public_save_push_subscription('alpha', ${hash}, ${endpoint}, 'p256', 'auth', 'test')`);
  return endpoint;
}

beforeAll(async () => {
  db = await openTestDb();
  tenantId = (await publish(db.sql, fixtureConfig())).tenantId;
  ids = await catalog(db.sql, tenantId);
  owner = await createOwner(db.sql, 'alpha');
});
afterAll(async () => db?.close());

it('preview tenants never produce real notifications', async () => {
  const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: await localMoment(db.sql, TZ, 4, '10:00')});
  const jobs = await db.sql`select status from app.notification_jobs where booking_id = ${b.booking.id}`;
  expect(jobs.length).toBeGreaterThan(0);
  expect(jobs.every((j) => j.status === 'suppressed')).toBe(true);
  const [demo] = await db.sql`select is_demo from app.bookings where id = ${b.booking.id}`;
  expect(demo!.is_demo).toBe(true);
});

describe('live tenant', () => {
  beforeAll(async () => {
    const r = await db.sql`select app.activate_tenant('alpha') as r`;
    expect(r[0]!.r.demoBookingsRemoved).toBe(1);
    await db.sql`insert into app.push_subscriptions (tenant_id, audience, user_id, endpoint, p256dh, auth_secret)
      values (${tenantId}, 'owner', ${owner}, 'https://push.example.test/owner', 'p', 'a')`;
  });

  it('enqueues owner notice and client reminders in the booking transaction, deduplicated', async () => {
    const start = await localMoment(db.sql, TZ, 5, '10:00');
    const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start});
    const jobs = await db.sql`select kind, status, dedupe_key from app.notification_jobs where booking_id = ${b.booking.id} order by id`;
    expect(jobs.map((j) => j.kind)).toEqual(['owner_new_booking', 'client_reminder', 'client_reminder']);
    expect(jobs.every((j) => j.status === 'pending')).toBe(true);
    // Re-running the scheduler does not duplicate
    await db.sql`select app.schedule_booking_notifications(${b.booking.id}, 'created', 'client')`;
    const again = await db.sql`select count(*)::int as n from app.notification_jobs where booking_id = ${b.booking.id}`;
    expect(again[0]!.n).toBe(3);
  });

  it('claims due jobs once, with a lease, and only the lease holder can finish', async () => {
    const [c1, c2] = await Promise.all([
      db.sql`select app.claim_notification_jobs('worker-1', 50, 60) as r`,
      db.sql`select app.claim_notification_jobs('worker-2', 50, 60) as r`,
    ]);
    const a = c1![0]!.r as {id: number; kind: string; subscriptions: unknown[]}[];
    const b = c2![0]!.r as {id: number}[];
    const ids1 = new Set(a.map((j) => j.id));
    expect(b.filter((j) => ids1.has(j.id))).toHaveLength(0); // no double claim
    const all = [...a, ...(b as typeof a)];
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.every((j) => j.kind === 'owner_new_booking')).toBe(true); // reminders are not due yet
    expect(all[0]!.subscriptions).toHaveLength(1);
    const job = all[0]!;
    const holder = ids1.has(job.id) ? 'worker-1' : 'worker-2';
    const thief = holder === 'worker-1' ? 'worker-2' : 'worker-1';
    const [lost] = await db.sql`select app.finish_notification_job(${job.id}, ${thief}, 'sent', null, 1, '{}') as ok`;
    expect(lost!.ok).toBe(false);
    const [ok] = await db.sql`select app.finish_notification_job(${job.id}, ${holder}, 'sent', null, 1, '{}') as ok`;
    expect(ok!.ok).toBe(true);
    for (const j of all.slice(1)) {
      await db.sql`select app.finish_notification_job(${j.id}, ${ids1.has(j.id) ? 'worker-1' : 'worker-2'}, 'sent', null, 1, '{}')`;
    }
  });

  it('an expired lease is reclaimed by another worker; retries back off; gone endpoints are removed', async () => {
    const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: await localMoment(db.sql, TZ, 6, '10:00')});
    const [claimed] = await db.sql`select app.claim_notification_jobs('crashy', 10, 60) as r`;
    const job = (claimed!.r as {id: number}[])[0]!;
    // Simulate a crashed worker: lease in the past
    await db.sql`update app.notification_jobs set lease_until = now() - interval '1 second' where id = ${job.id}`;
    const [re] = await db.sql`select app.claim_notification_jobs('healthy', 10, 60) as r`;
    expect((re!.r as {id: number; attempts: number}[]).map((j) => j.id)).toContain(job.id);
    expect((await db.sql`select app.finish_notification_job(${job.id}, 'crashy', 'sent', null, 1, '{}') as ok`)[0]!.ok).toBe(false);
    // Transient failure -> retry later
    await db.sql`select app.finish_notification_job(${job.id}, 'healthy', 'retry', 'HTTP 503', 0, '{}')`;
    const [r1] = await db.sql`select status, due_at > now() as later, attempts from app.notification_jobs where id = ${job.id}`;
    expect(r1).toMatchObject({status: 'pending', later: true, attempts: 2});
    // Push service says the owner endpoint is gone (410): subscription removed
    await db.sql`update app.notification_jobs set due_at = now() where id = ${job.id}`;
    await db.sql`select app.claim_notification_jobs('healthy', 10, 60)`;
    await db.sql`select app.finish_notification_job(${job.id}, 'healthy', 'failed', 'HTTP 410', 0, array['https://push.example.test/owner'])`;
    const subs = await db.sql`select 1 from app.push_subscriptions where endpoint = 'https://push.example.test/owner'`;
    expect(subs).toHaveLength(0);
    void b;
  });

  it('reschedule cancels old reminders and a stale reminder is skipped at claim time', async () => {
    await db.sql`insert into app.push_subscriptions (tenant_id, audience, user_id, endpoint, p256dh, auth_secret)
      values (${tenantId}, 'owner', ${owner}, 'https://push.example.test/owner2', 'p', 'a')`;
    const t = newToken();
    const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: await localMoment(db.sql, TZ, 7, '10:00'), tokenHash: t.hash});
    await subscribeClient(t.hash);
    const [old] = await db.sql`select id from app.notification_jobs where booking_id = ${b.booking.id} and kind = 'client_reminder' order by id limit 1`;
    const next = await localMoment(db.sql, TZ, 8, '12:00');
    await asAnon(db.sql, (tx) => tx`select app.public_reschedule_booking('alpha', ${t.hash}, ${next}, ${randomUUID()})`);
    const jobs = await db.sql`select id, kind, status, expected_start_at from app.notification_jobs where booking_id = ${b.booking.id} order by id`;
    expect(jobs.find((j) => j.id === old!.id)!.status).toBe('cancelled');
    const fresh = jobs.filter((j) => j.kind === 'client_reminder' && j.status === 'pending');
    expect(fresh.length).toBe(2);
    expect(fresh.every((j) => j.expected_start_at.toISOString() === next.toISOString())).toBe(true);
    expect(jobs.some((j) => j.kind === 'owner_booking_rescheduled')).toBe(true);

    // A reminder that was already claimed when the booking moved is skipped as stale.
    const [pending] = await db.sql`select id from app.notification_jobs where booking_id = ${b.booking.id} and kind = 'client_reminder' and status = 'pending' limit 1`;
    await db.sql`update app.notification_jobs set due_at = now() - interval '1 minute', expected_start_at = expected_start_at - interval '1 day' where id = ${pending!.id}`;
    const [claimed] = await db.sql`select app.claim_notification_jobs('w', 50, 60) as r`;
    expect((claimed!.r as {id: number}[]).map((j) => j.id)).not.toContain(pending!.id);
    const [st] = await db.sql`select status, last_error from app.notification_jobs where id = ${pending!.id}`;
    expect(st).toEqual({status: 'skipped', last_error: 'stale'});
  });

  it('jobs without subscriptions are skipped, not sent', async () => {
    await db.sql`delete from app.push_subscriptions where audience = 'owner'`;
    const b = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: await localMoment(db.sql, TZ, 9, '10:00')});
    const [claimed] = await db.sql`select app.claim_notification_jobs('w', 50, 60) as r`;
    expect(claimed!.r).toEqual([]);
    const [st] = await db.sql`select status, last_error from app.notification_jobs where booking_id = ${b.booking.id} and kind = 'owner_new_booking'`;
    expect(st).toEqual({status: 'skipped', last_error: 'no_subscriptions'});
  });
});
