// End-to-end test of the tenant pipeline CLI against a real database:
// tenant:new -> tenant:validate -> tenant:publish -> render -> tenant:verify,
// a second studio that must not replace the first, and a config re-publish
// that must keep bookings and owner uploads.
import {execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {openTestDb, catalog, localMoment, publicBook, createOwner, type TestDb} from './harness.ts';
import {adminUrl} from './env.ts';

const ROOT = resolve(import.meta.dirname, '../..');
let db: TestDb;
let work: string;
let env: NodeJS.ProcessEnv;

function cli(script: string, args: string[], expectFail = false): string {
  try {
    const out = execFileSync(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'scripts/tenant', script), ...args], {env, encoding: 'utf8', stdio: 'pipe'});
    if (expectFail) throw new Error(`expected ${script} to fail, got:\n${out}`);
    return out;
  } catch (error) {
    const e = error as {status?: number; stdout?: string; stderr?: string; message: string};
    if (expectFail && e.status) return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    throw new Error(`${script} ${args.join(' ')} failed: ${e.stdout ?? ''}${e.stderr ?? ''}${e.message}`, {cause: error});
  }
}

beforeAll(async () => {
  db = await openTestDb();
  work = mkdtempSync(join(tmpdir(), 'tenants-'));
  mkdirSync(join(work, 'tenants'));
  cpSync(join(ROOT, 'tenants/_template'), join(work, 'tenants/_template'), {recursive: true});
  env = {...process.env, TENANTS_DIR: join(work, 'tenants'), DATABASE_URL: adminUrl(db.name)};
}, 60_000);
afterAll(async () => db?.close());

it('clones a studio from the template, validates and publishes it', () => {
  const out = cli('new.ts', ['pipe-a', '--name', 'Pipe A Studio', '--accent', '#B084FF', '--timezone', 'Asia/Novosibirsk']);
  expect(out).toContain('✔ pipe-a');
  const cfg = JSON.parse(readFileSync(join(work, 'tenants/pipe-a/business.json'), 'utf8'));
  expect(cfg).toMatchObject({slug: 'pipe-a', name: 'Pipe A Studio', timezone: 'Asia/Novosibirsk'});
  expect(cli('validate.ts', ['pipe-a'])).toContain('✔ pipe-a');
  const pub = cli('publish.ts', ['pipe-a']);
  expect(pub).toContain('статус preview, новая студия');
});

it('refuses an invalid config with a readable reason', () => {
  cli('new.ts', ['pipe-bad']);
  const file = join(work, 'tenants/pipe-bad/business.json');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  cfg.timezone = 'Mars/Base';
  cfg.brand.accent = '#0C0D0F';
  writeFileSync(file, JSON.stringify(cfg));
  const out = cli('validate.ts', ['pipe-bad'], true);
  expect(out).toContain('timezone');
  const pub = cli('publish.ts', ['pipe-bad'], true);
  expect(pub).toContain('✖ pipe-bad');
});

it('a second studio does not replace the first, republish keeps bookings and owner photos', async () => {
  cli('new.ts', ['pipe-b', '--from', 'pipe-a', '--name', 'Pipe B', '--timezone', 'Europe/Moscow']);
  cli('publish.ts', ['pipe-b']);
  const tenants = await db.sql`select slug from app.tenants order by slug`;
  expect(tenants.map((t) => t.slug)).toEqual(['pipe-a', 'pipe-b']);

  const [a] = await db.sql`select id from app.tenants where slug = 'pipe-a'`;
  const ids = await catalog(db.sql, a!.id);
  const booking = await publicBook(db.sql, {slug: 'pipe-a', serviceId: ids.service.wash!, start: await localMoment(db.sql, 'Asia/Novosibirsk', 3, '10:00')});
  await db.sql`insert into app.media (tenant_id, source, kind, path, alt) values (${a!.id}, 'owner', 'gallery', ${`tenants/${a!.id}/owner/x.webp`}, 'owner')`;

  const file = join(work, 'tenants/pipe-a/business.json');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  cfg.services[0].price.amount = 2500;
  cfg.tagline = 'Updated tagline';
  writeFileSync(file, JSON.stringify(cfg));
  const out = cli('publish.ts', ['pipe-a']);
  expect(out).toContain('"priceChanges":1');
  expect(out).toContain('"bookings":1');
  expect(out).toContain('"ownerMedia":1');
  const [b] = await db.sql`select price_amount from app.bookings where id = ${booking.booking.id}`;
  expect(Number(b!.price_amount)).toBe(2000);
  const [owned] = await db.sql`select count(*)::int as n from app.media where tenant_id = ${a!.id} and source = 'owner'`;
  expect(owned!.n).toBe(1);
});

it('renders both shells with their own manifests and verifies the published studio', async () => {
  const out = join(work, 'dist');
  mkdirSync(join(out, 'shell'), {recursive: true});
  const template = '<!doctype html><html><head><!--tenant-head--><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div><!--tenant-boot--></body></html>';
  writeFileSync(join(out, 'shell/client.html'), template);
  writeFileSync(join(out, 'shell/owner.html'), template);
  execFileSync(join(ROOT, 'node_modules/.bin/tsx'), [join(ROOT, 'scripts/tenant/render-site.ts'), '--out', out, '--only', 'pipe-a', '--only', 'pipe-b'], {env, stdio: 'pipe'});
  for (const slug of ['pipe-a', 'pipe-b']) {
    const html = readFileSync(join(out, `s/${slug}/index.html`), 'utf8');
    expect(html).toContain(`/t/${slug}/manifest.webmanifest`);
    const manifest = JSON.parse(readFileSync(join(out, `t/${slug}/manifest.webmanifest`), 'utf8'));
    expect(manifest.scope).toBe(`/s/${slug}/`);
    expect(existsSync(join(out, `t/${slug}/icons/maskable-512.png`))).toBe(true);
  }
  // verify fails before the owner exists only for live readiness, not for preview
  const verify = cli('verify.ts', ['pipe-a', '--dist', out]);
  expect(verify).toContain('Все проверки прошли');
  // go live requires an owner
  const refused = cli('publish.ts', ['pipe-a', '--live'], true);
  expect(refused).toContain('не назначен владелец');
  await createOwner(db.sql, 'pipe-a');
  const live = cli('publish.ts', ['pipe-a', '--live']);
  expect(live).toContain('Live включён. Удалено демо-записей: 1');
});
