#!/usr/bin/env tsx
// npm run cloud:prepare — prepares the Supabase project from settings.env:
//   1. checks settings.env, generates server secrets and Web Push keys once
//   2. applies database migrations (schema, security, cron, storage bucket)
//   3. stores the cron URL/secret in Supabase Vault and checks the cron jobs
//   4. publishes every studio from tenants/ (preview mode)
//   5. checks Auth: sign-up must be off; JWT verification settings
// Safe to run again: nothing is duplicated, generated secrets are kept.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postgres from 'postgres';
import {applyMigrations} from '../db/migrate.mjs';
import {listTenantSlugs} from '../tenant/lib/load.ts';
import {publishTenant} from '../tenant/lib/publish.ts';
import {
  ROOT_DIR,
  appendSettings,
  fail,
  generateVapidKeys,
  ok,
  openSettings,
  randomSecret,
  requireSettings,
  say,
  setting,
  supabaseUrl,
  vapidPublicFromPrivate,
  warn,
  warnings,
} from './common.ts';

openSettings();
requireSettings('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'DATABASE_URL', 'ADMIN_EMAIL', 'SITE_NAME');
ok('settings.env заполнен');

// --- 1. secrets -------------------------------------------------------------
const generated: Record<string, string> = {};
if (!setting('BOOKING_TOKEN_SECRET')) generated.BOOKING_TOKEN_SECRET = randomSecret(32);
if (!setting('CRON_SECRET')) generated.CRON_SECRET = randomSecret(24);
if (!setting('VAPID_PRIVATE_KEY') || !setting('VAPID_PUBLIC_KEY')) {
  const keys = generateVapidKeys();
  generated.VAPID_PUBLIC_KEY = keys.publicKey;
  generated.VAPID_PRIVATE_KEY = keys.privateKey;
}
if (Object.keys(generated).length) {
  appendSettings(generated);
  ok(`созданы секретные ключи сервера (${Object.keys(generated).join(', ')}) и записаны в settings.env`);
} else if (vapidPublicFromPrivate(setting('VAPID_PRIVATE_KEY')!) !== setting('VAPID_PUBLIC_KEY')) {
  fail('В settings.env повреждены ключи VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Удалите обе строки и запустите команду снова.');
} else {
  ok('секретные ключи сервера уже есть');
}

// --- 2. database -------------------------------------------------------------
const sql = postgres(setting('DATABASE_URL')!, {max: 1, prepare: false, onnotice: () => undefined, connect_timeout: 20});
try {
  try {
    await sql`select 1`;
  } catch (error) {
    fail(
      `Не удалось подключиться к базе: ${(error as Error).message}\n` +
        '  Проверьте DATABASE_URL: строка из Connect → Session pooler, вместо [YOUR-PASSWORD] — пароль базы.\n' +
        '  Забыли пароль — Supabase → Project Settings → Database → Reset database password.',
    );
  }
  ok('подключение к базе');

  await applyMigrations(sql, {log: (m: string) => say(`  ${m}`)});
  ok('структура базы актуальна');

  // --- 3. cron + vault -------------------------------------------------------
  try {
    for (const [name, value] of [
      ['project_url', supabaseUrl()],
      ['cron_secret', setting('CRON_SECRET')!],
    ] as const) {
      const [row] = await sql<{id: string}[]>`select id from vault.secrets where name = ${name}`;
      if (row) await sql`select vault.update_secret(${row.id}::uuid, ${value})`;
      else await sql`select vault.create_secret(${value}, ${name})`;
    }
    ok('адрес и секрет для расписания уведомлений сохранены в Vault');
  } catch (error) {
    warn(`не удалось записать секреты в Vault: ${(error as Error).message}`);
  }

  const cronJobs = async () => {
    try {
      return (await sql<{jobname: string}[]>`select jobname from cron.job where jobname in ('notify-dispatch', 'app-housekeeping')`).length;
    } catch {
      return 0;
    }
  };
  if ((await cronJobs()) < 2) {
    // The cron migration skips itself when pg_cron/pg_net are unavailable; it is idempotent, so run it again.
    const cronFile = resolve(ROOT_DIR, 'supabase/migrations/20260928090700_cron.sql');
    await sql.unsafe(readFileSync(cronFile, 'utf8')).catch((e: Error) => warn(`расписание: ${e.message}`));
  }
  if ((await cronJobs()) === 2) ok('расписание уведомлений включено (pg_cron)');
  else warn('расписание уведомлений не включилось: Supabase → Database → Extensions → включите pg_cron и pg_net, затем повторите npm run cloud:prepare');

  // --- 4. studios --------------------------------------------------------------
  for (const slug of listTenantSlugs()) {
    const r = await publishTenant(sql, slug, {quiet: true});
    if (!r) fail(`Студия ${slug} не прошла проверку (подробности выше).`);
    ok(`студия ${slug}: опубликована (режим ${r.status === 'live' ? 'работает' : 'демо'})`);
  }
} finally {
  await sql.end({timeout: 5});
}

// --- 5. auth -----------------------------------------------------------------
try {
  const res = await fetch(`${supabaseUrl()}/auth/v1/settings`, {headers: {apikey: setting('SUPABASE_PUBLISHABLE_KEY')!}});
  const auth = (await res.json()) as {disable_signup?: boolean};
  if (auth.disable_signup === true) ok('регистрация посторонних в Supabase Auth выключена');
  else warn('в Supabase открыта регистрация: Authentication → Sign In / Providers → выключите «Allow new users to sign up» и сохраните');
} catch (error) {
  warn(`не удалось проверить настройки входа: ${(error as Error).message}`);
}
try {
  const res = await fetch(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`);
  const jwks = (await res.json()) as {keys?: unknown[]};
  if (jwks.keys?.length) ok('ключи подписи входа доступны серверу (JWKS)');
  else if (setting('AUTH_JWT_SECRET')) ok('проект использует старый JWT secret — он указан в settings.env');
  else
    warn(
      'проект подписывает вход старым общим секретом. Supabase → Project Settings → JWT Keys → скопируйте Legacy JWT secret в строку AUTH_JWT_SECRET в settings.env',
    );
} catch (error) {
  warn(`не удалось проверить ключи входа: ${(error as Error).message}`);
}

if (warnings) say(`\nЕсть предупреждения (!): ${warnings}. Исправьте их по подсказкам и запустите npm run cloud:prepare ещё раз — сделанное не повторится.`);
say('\nГотово. Дальше:');
say('  npm run cloud:login       (один раз: вход в Supabase и Cloudflare через браузер)');
say('  npm run cloud:functions   (серверные функции)');
say('  npm run cloud:site        (сайт на Cloudflare)');
