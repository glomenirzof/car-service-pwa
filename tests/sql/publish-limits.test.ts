// Republishing preserves runtime data; preview -> live activation; shared
// atomic counters for rate limits / LLM budget.
import postgres from 'postgres';
import {fixtureConfig} from '../fixtures/business.ts';
import {openTestDb, publish, catalog, localMoment, publicBook, asUser, createOwner, expectDbError, type TestDb} from './harness.ts';
import {adminUrl} from './env.ts';

let db: TestDb;
const TZ = 'Europe/Moscow';

beforeAll(async () => {
  db = await openTestDb();
});
afterAll(async () => db?.close());

it('republishing keeps bookings, owner photos, owner exceptions and pause flags', async () => {
  const first = await publish(db.sql, fixtureConfig());
  expect(first.created).toBe(true);
  expect(first.status).toBe('preview');
  const ids = await catalog(db.sql, first.tenantId);
  const owner = await createOwner(db.sql, 'alpha');
  const booking = await publicBook(db.sql, {slug: 'alpha', serviceId: ids.service.wash!, start: await localMoment(db.sql, TZ, 5, '10:00')});
  await asUser(db.sql, owner, async (tx) => {
    await tx`select app.owner_add_media(${first.tenantId}, ${`tenants/${first.tenantId}/owner/photo-1.webp`}, 'Owner shot', 1200, 800)`;
    await tx`select app.owner_set_exception(${first.tenantId}, current_date + 20, '[]'::jsonb, 'Owner day off')`;
    await tx`select app.owner_set_paused(${first.tenantId}, 'resource', ${ids.resource['box-b']!}, true)`;
  });
  await expectDbError(
    asUser(db.sql, owner, (tx) => tx`select app.owner_add_media(${first.tenantId}, 'tenants/other/owner/x.webp', '', 1, 1)`),
    'invalid_input',
  );

  // New config: renamed service, one service removed, one added, new gallery.
  const cfg = fixtureConfig({
    gallery: [{file: 'images/g1.jpg', alt: 'New gallery photo'}],
  });
  cfg.services = [
    {...cfg.services[0]!, name: 'Wash Premium'},
    {key: 'polish', name: 'Polish', category: 'Care', description: '', durationMinutes: 240, bufferMinutes: 30, completion: 'same_day', capability: 'wash', price: {amount: 9000, from: false}, popular: false},
  ];
  const second = await publish(db.sql, cfg);
  expect(second.created).toBe(false);
  expect(second.services).toMatchObject({added: 1, updated: 1, deactivated: 1});

  const [b] = await db.sql`select status, service_name from app.bookings where id = ${booking.booking.id}`;
  expect(b).toEqual({status: 'scheduled', service_name: 'Wash'}); // snapshot kept
  const media = await db.sql`select source, kind, path from app.media where tenant_id = ${first.tenantId} order by source, kind`;
  expect(media.filter((m) => m.source === 'owner')).toHaveLength(1);
  expect(media.filter((m) => m.source === 'config').map((m) => m.kind).sort()).toEqual(['gallery', 'hero']);
  const [exc] = await db.sql`select count(*)::int n from app.schedule_exceptions where tenant_id = ${first.tenantId} and source = 'owner'`;
  expect(exc!.n).toBe(1);
  const [paused] = await db.sql`select is_paused from app.resources where id = ${ids.resource['box-b']!}`;
  expect(paused!.is_paused).toBe(true);
  const [coating] = await db.sql`select is_active from app.services where id = ${ids.service.coating!}`;
  expect(coating!.is_active).toBe(false);
  const pub = await db.sql`select app.public_tenant('alpha') as r`;
  expect(pub[0]!.r.services.map((s: {key: string}) => s.key)).toEqual(['wash', 'polish']);
});

it('activation requires complete settings and an owner, then removes demo data', async () => {
  const r = await publish(db.sql, fixtureConfig({slug: 'gamma', name: 'Gamma Test', shortName: 'Gamma'}));
  const ids = await catalog(db.sql, r.tenantId);
  await publicBook(db.sql, {slug: 'gamma', serviceId: ids.service.wash!, start: await localMoment(db.sql, TZ, 5, '10:00')});
  const err = await expectDbError(db.sql`select app.activate_tenant('gamma')`, 'not_ready');
  expect(err.detail).toContain('владелец');
  await createOwner(db.sql, 'gamma');
  const [ok] = await db.sql`select app.activate_tenant('gamma') as r`;
  expect(ok!.r).toMatchObject({status: 'live', demoBookingsRemoved: 1});
  const [left] = await db.sql`select count(*)::int n from app.bookings where tenant_id = ${r.tenantId}`;
  expect(left!.n).toBe(0);
  const live = await publicBook(db.sql, {slug: 'gamma', serviceId: ids.service.wash!, start: await localMoment(db.sql, TZ, 6, '10:00')});
  const [demo] = await db.sql`select is_demo from app.bookings where id = ${live.booking.id}`;
  expect(demo!.is_demo).toBe(false);
  // Republishing a live tenant keeps it live
  const again = await publish(db.sql, fixtureConfig({slug: 'gamma', name: 'Gamma Test', shortName: 'Gamma'}));
  expect(again.status).toBe('live');
});

it('usage counters are atomic under concurrency', async () => {
  const conns = Array.from({length: 8}, () => postgres(adminUrl(db.name), {max: 1, onnotice: () => {}}));
  try {
    const results = await Promise.all(
      Array.from({length: 40}, (_, i) =>
        conns[i % conns.length]!`select app.usage_hit('rl:test', 60, 25, 1) as r`.then((rows) => rows[0]!.r as {allowed: boolean}),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(25);
    const [n] = await db.sql`select app.usage_get('rl:test', 60) as n`;
    expect(Number(n!.n)).toBe(40);
  } finally {
    await Promise.all(conns.map((c) => c.end()));
  }
});
