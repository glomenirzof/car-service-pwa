#!/usr/bin/env tsx
// npm run tenant:publish -- <slug> [--live] [--dry-run]
// Publishes business.json into the runtime database. Existing bookings,
// customers, payments, owner photos, owner schedule exceptions and pause flags
// are preserved. --live activates the studio after the readiness check
// (removes demo data and enables real notifications).
import {parseArgs} from 'node:util';
import {checkTenant, printReport} from './lib/checks.ts';
import {imageMeta} from './lib/assets.ts';
import {buildPublishPayload, configHash} from './lib/payload.ts';
import {connect} from './lib/db.ts';
import {publishTenant} from './lib/publish.ts';
import {loadSettings} from '../lib/settings.ts';

loadSettings();

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {live: {type: 'boolean', default: false}, 'dry-run': {type: 'boolean', default: false}},
});
const slug = positionals[0];
if (!slug) {
  console.error('usage: npm run tenant:publish -- <slug> [--live] [--dry-run]');
  process.exit(2);
}

if (values['dry-run']) {
  const report = await checkTenant(slug);
  printReport(report);
  if (!report.ok || !report.config) process.exit(1);
  const payload = buildPublishPayload(report.config, await imageMeta(report.config));
  console.log(JSON.stringify({hash: configHash(report.config), services: payload.services.length, resources: payload.resources.length, media: payload.media.length}, null, 2));
  process.exit(0);
}

const sql = connect();
try {
  const r = await publishTenant(sql, slug);
  if (!r) process.exit(1);
  console.log(`Опубликовано: ${slug} (версия ${r.configVersion}, статус ${r.status}${r.created ? ', новая студия' : ''})`);
  console.log(`  услуги: ${JSON.stringify(r.services)}; ресурсы: ${JSON.stringify(r.resources)}`);
  console.log(`  сохранено: ${JSON.stringify(r.preserved)}`);
  for (const w of r.warnings ?? []) console.log(`  внимание: ${w}`);

  if (values.live) {
    const [rd] = await sql`select app.tenant_readiness(${slug}) as r`;
    const readiness = rd!.r as {ready: boolean; problems: string[]; demoBookings: number; status: string};
    if (readiness.status === 'live') {
      console.log('Студия уже в режиме live.');
    } else if (!readiness.ready) {
      console.error('Нельзя включить live, не хватает настроек:');
      for (const p of readiness.problems) console.error(`  - ${p}`);
      process.exit(1);
    } else {
      const [act] = await sql`select app.activate_tenant(${slug}) as r`;
      console.log(`Live включён. Удалено демо-записей: ${(act!.r as {demoBookingsRemoved: number}).demoBookingsRemoved}.`);
    }
  }
  console.log('Статика студии (оболочка, иконки, фото) публикуется сборкой: npm run build → деплой dist/ (Cloudflare Pages).');
} finally {
  await sql.end();
}
