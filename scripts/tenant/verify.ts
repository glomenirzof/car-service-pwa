#!/usr/bin/env tsx
// npm run tenant:verify -- <slug> [--dist dist] [--url https://site] [--api https://<ref>.supabase.co/functions/v1]
// Checks what was actually published, not what the config says:
//   db     : tenant exists, published hash == local config, readiness, bookable
//            slots in the next 14 days, anon cannot read tables (DATABASE_URL)
//   static : shell HTML, manifest id/start_url/scope, icons and splash files (dist/)
//   remote : deployed shell + deep link + manifest + sw.js header (--url)
//   api    : public tenant endpoint of the deployed functions (--api)
import {parseArgs} from 'node:util';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import sharp from 'sharp';
import {checkTenant} from './lib/checks.ts';
import {configHash} from './lib/payload.ts';
import {ROOT} from './lib/load.ts';
import {STARTUP_DEVICES, startupFile} from './lib/devices.ts';
import {connect} from './lib/db.ts';

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {dist: {type: 'string', default: 'dist'}, url: {type: 'string'}, api: {type: 'string'}, 'skip-db': {type: 'boolean', default: false}},
});
const slug = positionals[0];
if (!slug) {
  console.error('usage: npm run tenant:verify -- <slug> [--dist dist] [--url https://...] [--api https://.../functions/v1]');
  process.exit(2);
}

const results: {area: string; ok: boolean; message: string}[] = [];
const pass = (area: string, message: string) => results.push({area, ok: true, message});
const fail = (area: string, message: string) => results.push({area, ok: false, message});

const report = await checkTenant(slug);
if (!report.ok || !report.config) {
  report.errors.forEach((e) => fail('config', e));
} else {
  pass('config', 'business.json и изображения валидны');
}
const cfg = report.config;

// --- database -------------------------------------------------------------
if (cfg && !values['skip-db'] && (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL)) {
  const sql = connect();
  try {
    const [rd] = await sql`select app.tenant_readiness(${slug}) as r`.catch((e) => {
      fail('db', `студия не найдена в БД: ${e.message}. Выполните npm run tenant:publish -- ${slug}`);
      return [];
    });
    if (rd) {
      const r = rd.r as {status: string; configHash: string; ready: boolean; problems: string[]; bookableServices: number; demoBookings: number; realBookings: number};
      if (r.configHash === configHash(cfg)) pass('db', `опубликована текущая версия конфига (статус ${r.status})`);
      else fail('db', 'в БД другая версия business.json — выполните tenant:publish');
      if (r.status === 'live' && r.demoBookings > 0) fail('db', `live-студия содержит ${r.demoBookings} демо-записей`);
      if (r.status === 'preview') pass('db', `preview: демо-записей ${r.demoBookings}, уведомления не отправляются`);
      r.problems.forEach((p) => (r.status === 'live' ? fail : pass)('db', `${r.status === 'live' ? '' : '(для live) '}${p}`));

      const services = await sql`select s.id, s.name from app.services s join app.tenants t on t.id = s.tenant_id
                                 where t.slug = ${slug} and s.is_active and not s.is_paused`;
      let withSlots = 0;
      for (const s of services) {
        const rows = await sql.begin(async (tx) => {
          await tx`set local role anon`;
          return tx`select app.public_availability(${slug}, ${s.id}, (now() at time zone ${cfg.timezone})::date,
                    (now() at time zone ${cfg.timezone})::date + 14) as r`;
        });
        const days = (rows[0]!.r as {days: {slots: unknown[]}[]}).days;
        if (days.some((d) => d.slots.length > 0)) withSlots++;
        else fail('db', `нет свободного времени на 15 дней для «${s.name}»`);
      }
      if (withSlots) pass('db', `свободное время есть у ${withSlots} из ${services.length} услуг`);

      const denied = await sql
        .begin(async (tx) => {
          await tx`set local role anon`;
          await tx`select 1 from app.bookings limit 1`;
        })
        .then(
          () => false,
          (e: Error) => /permission denied/.test(e.message),
        );
      (denied ? pass : fail)('db', denied ? 'anon не имеет доступа к таблицам' : 'anon читает таблицы — проверьте GRANT');
    }
  } finally {
    await sql.end();
  }
} else if (!values['skip-db']) {
  fail('db', 'DATABASE_URL не задан — проверка БД пропущена');
}

// --- static build ---------------------------------------------------------
const dist = resolve(ROOT, values.dist!);
if (cfg && existsSync(join(dist, 's', slug, 'index.html'))) {
  const html = readFileSync(join(dist, 's', slug, 'index.html'), 'utf8');
  const ownerHtml = readFileSync(join(dist, 's', slug, 'owner', 'index.html'), 'utf8');
  (html.includes(`/t/${slug}/manifest.webmanifest`) ? pass : fail)('static', 'клиентская оболочка ссылается на свой manifest');
  (ownerHtml.includes(`/t/${slug}/owner.webmanifest`) ? pass : fail)('static', 'оболочка кабинета ссылается на свой manifest');
  (html.includes(`<title>${cfg.name.replace(/&/g, '&amp;')}</title>`) ? pass : fail)('static', 'title студии в оболочке');
  const manifest = JSON.parse(readFileSync(join(dist, 't', slug, 'manifest.webmanifest'), 'utf8'));
  const okManifest = manifest.id === `/s/${slug}/` && manifest.scope === `/s/${slug}/` && manifest.start_url.startsWith(`/s/${slug}/`);
  (okManifest ? pass : fail)('static', `manifest id/scope/start_url = ${manifest.id} ${manifest.scope} ${manifest.start_url}`);
  for (const [file, size] of [['icons/icon-192.png', 192], ['icons/icon-512.png', 512], ['icons/maskable-512.png', 512], ['icons/apple-touch-icon.png', 180]] as const) {
    const path = join(dist, 't', slug, file);
    if (!existsSync(path)) {
      fail('static', `нет ${file}`);
      continue;
    }
    const m = await sharp(path).metadata();
    (m.width === size && m.height === size ? pass : fail)('static', `${file} ${m.width}×${m.height}`);
    if (file === 'icons/apple-touch-icon.png' && m.hasAlpha) {
      const stats = await sharp(path).stats();
      (stats.isOpaque ? pass : fail)('static', 'apple-touch-icon непрозрачный');
    }
  }
  const missingSplash = STARTUP_DEVICES.filter((d) => !existsSync(join(dist, 't', slug, 'splash', startupFile(d))));
  (missingSplash.length ? fail : pass)('static', `стартовые экраны iOS: ${STARTUP_DEVICES.length - missingSplash.length}/${STARTUP_DEVICES.length}`);
  const redirects = existsSync(join(dist, '_redirects')) ? readFileSync(join(dist, '_redirects'), 'utf8') : '';
  (redirects.includes('/s/:slug/* /s/:slug/index.html 200') ? pass : fail)('static', '_redirects отдаёт оболочку студии на глубоких ссылках');
} else if (cfg) {
  fail('static', `нет ${join(values.dist!, 's', slug, 'index.html')} — выполните npm run build`);
}

// --- deployed site ----------------------------------------------------------
if (cfg && values.url) {
  const base = values.url.replace(/\/$/, '');
  const get = async (path: string) => fetch(`${base}${path}`, {redirect: 'manual', headers: {Accept: 'text/html'}});
  const shell = await get(`/s/${slug}/`);
  const shellText = await shell.text();
  (shell.status === 200 && shellText.includes(`/t/${slug}/manifest.webmanifest`) ? pass : fail)('remote', `GET /s/${slug}/ → ${shell.status}`);
  const deep = await get(`/s/${slug}/bookings/deep-link-check`);
  const deepText = await deep.text();
  (deep.status === 200 && deepText.includes(`/t/${slug}/manifest.webmanifest`) ? pass : fail)('remote', `глубокая ссылка → оболочка своей студии (${deep.status})`);
  const owner = await get(`/s/${slug}/owner/schedule`);
  (owner.status === 200 && (await owner.text()).includes(`/t/${slug}/owner.webmanifest`) ? pass : fail)('remote', `глубокая ссылка кабинета (${owner.status})`);
  const sw = await fetch(`${base}/sw.js`);
  (sw.ok && sw.headers.get('service-worker-allowed') === '/s/' ? pass : fail)('remote', `sw.js Service-Worker-Allowed: ${sw.headers.get('service-worker-allowed')}`);
  const mf = await fetch(`${base}/t/${slug}/manifest.webmanifest`);
  (mf.ok ? pass : fail)('remote', `manifest ${mf.status}`);
}

// --- deployed API -----------------------------------------------------------
const api = values.api ?? (process.env.VITE_SUPABASE_URL ? `${process.env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1` : undefined);
if (cfg && api && (values.api || values.url)) {
  const r = await fetch(`${api}/public-api/tenant/${slug}`);
  const body = r.ok ? await r.json() : null;
  (r.ok && body?.tenant?.slug === slug ? pass : fail)('api', `public-api/tenant/${slug} → ${r.status}`);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? '✔' : '✖'} [${r.area}] ${r.message}`);
}
console.log(failed ? `\n${failed} проверок не прошли` : '\nВсе проверки прошли');
process.exit(failed ? 1 : 0);
