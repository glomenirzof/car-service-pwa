#!/usr/bin/env tsx
// npm run cloud:site — builds the site with the public keys from settings.env
// and uploads it to Cloudflare Pages (project SITE_NAME, created on first run).
// Run again after any change in the app or in tenants/.
import {listTenantSlugs, loadTenantOrThrow} from '../tenant/lib/load.ts';
import {WRANGLER, appendSettings, fail, ok, openSettings, requireSettings, runNpm, runNpxCapture, say, setting, supabaseUrl, warn} from './common.ts';

openSettings();
requireSettings('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SITE_NAME');
if (!setting('VAPID_PUBLIC_KEY')) fail('Сначала выполните npm run cloud:prepare.');
const name = setting('SITE_NAME')!;

say('Собираю сайт (1–2 минуты)…');
const built = runNpm(['run', 'build'], {
  // Only public values go into the browser bundle.
  VITE_SUPABASE_URL: supabaseUrl(),
  VITE_SUPABASE_PUBLISHABLE_KEY: setting('SUPABASE_PUBLISHABLE_KEY'),
  VITE_VAPID_PUBLIC_KEY: setting('VAPID_PUBLIC_KEY'),
  VITE_FUNCTIONS_URL: '',
  VITE_STORAGE_PUBLIC_URL: '',
});
if (built !== 0) fail('Сборка не удалась — текст ошибки выше.');
ok('сайт собран');

const created = await runNpxCapture([WRANGLER, 'pages', 'project', 'create', name, '--production-branch', 'main'], {echo: false});
if (created.status === 0) ok(`в Cloudflare создан проект ${name}`);
else if (!/already exists|8000002/i.test(created.output)) {
  say(created.output);
  fail(/auth|login|not logged|api[_ ]token/i.test(created.output) ? 'Нет входа в Cloudflare: выполните npm run cloud:login.' : 'Не удалось создать проект в Cloudflare — текст ошибки выше.');
}

say('Загружаю сайт в Cloudflare…');
const deployed = await runNpxCapture([WRANGLER, 'pages', 'deploy', 'dist', '--project-name', name, '--branch', 'main', '--commit-dirty=true']);
if (deployed.status !== 0) fail(/auth|login|api[_ ]token/i.test(deployed.output) ? 'Нет входа в Cloudflare: выполните npm run cloud:login.' : 'Загрузка не удалась — текст ошибки выше.');

// The production address is <subdomain>.pages.dev; the subdomain can differ
// from the project name when that name is taken on pages.dev.
const match = deployed.output.match(/https:\/\/[a-z0-9]+\.([a-z0-9-]+)\.pages\.dev/);
const site = `https://${match?.[1] ?? name}.pages.dev`;
appendSettings({SITE_URL: site});
ok(`сайт загружен: ${site}`);

const slugs = listTenantSlugs();
let live = false;
for (let i = 0; i < 20 && !live; i++) {
  try {
    const res = await fetch(`${site}/s/${slugs[0]}/`);
    live = res.ok && (await res.text()).includes('tenant-boot');
  } catch {
    /* DNS for a new project can take a moment */
  }
  if (!live) await new Promise((r) => setTimeout(r, 3000));
}
if (live) ok('сайт открывается');
else warn('сайт пока не открывается — для нового проекта это бывает первые минуты. Проверьте позже: npm run cloud:check');

say('\nАдреса:');
for (const slug of slugs) {
  say(`  ${loadTenantOrThrow(slug).name}`);
  say(`    клиенты: ${site}/s/${slug}/`);
  say(`    кабинет: ${site}/s/${slug}/owner/`);
}
say('\nОдин раз укажите адрес сайта в Supabase → Authentication → URL Configuration:');
say(`  Site URL:       ${site}`);
say(`  Redirect URLs:  ${site}/s/*/owner/**   (кнопка Add URL)`);
say('\nДальше: npm run cloud:owner — выдать доступ к кабинету.');
