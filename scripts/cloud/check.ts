#!/usr/bin/env tsx
// npm run cloud:check — checks what is actually published for every studio:
// database state, the site on Cloudflare (deep links, manifest, service worker
// header) and the public API of the functions (tenant:verify for each studio).
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {listTenantSlugs} from '../tenant/lib/load.ts';
import {ROOT_DIR, fail, ok, openSettings, requireSettings, runNpm, say, setting, supabaseUrl} from './common.ts';

openSettings();
requireSettings('SUPABASE_URL', 'DATABASE_URL');
const site = setting('SITE_URL');
if (!site) fail('Сначала выполните npm run cloud:site.');
if (!existsSync(resolve(ROOT_DIR, 'dist', 's'))) fail('Нет собранного сайта — выполните npm run cloud:site.');

let failed = 0;
for (const slug of listTenantSlugs()) {
  say(`\n— ${slug}`);
  if (runNpm(['run', '-s', 'tenant:verify', '--', slug, '--url', site, '--api', `${supabaseUrl()}/functions/v1`]) !== 0) failed++;
}
if (failed) fail(`Проверку не прошли студий: ${failed}. Подробности выше.`);
ok('все студии опубликованы и отвечают');
