#!/usr/bin/env tsx
// npm run cloud:functions — uploads server secrets from settings.env and
// deploys the four Edge Functions to the Supabase project, then checks that
// the public API answers. Run again after any change in supabase/functions.
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ROOT_DIR, SUPABASE_CLI, fail, ok, openSettings, projectRef, requireSettings, runNpx, say, setting, supabaseUrl} from './common.ts';

openSettings();
requireSettings('SUPABASE_URL', 'ADMIN_EMAIL');
if (!setting('BOOKING_TOKEN_SECRET') || !setting('VAPID_PRIVATE_KEY')) fail('Сначала выполните npm run cloud:prepare — он создаст секретные ключи.');

const ref = projectRef();
const secrets: Record<string, string | undefined> = {
  BOOKING_TOKEN_SECRET: setting('BOOKING_TOKEN_SECRET'),
  CRON_SECRET: setting('CRON_SECRET'),
  VAPID_PUBLIC_KEY: setting('VAPID_PUBLIC_KEY'),
  VAPID_PRIVATE_KEY: setting('VAPID_PRIVATE_KEY'),
  VAPID_SUBJECT: `mailto:${setting('ADMIN_EMAIL')}`,
  AUTH_JWT_SECRET: setting('AUTH_JWT_SECRET'),
  LLM_BASE_URL: setting('LLM_BASE_URL'),
  LLM_API_KEY: setting('LLM_API_KEY'),
  LLM_MODEL: setting('LLM_MODEL'),
};
const llm = [secrets.LLM_BASE_URL, secrets.LLM_API_KEY, secrets.LLM_MODEL].filter(Boolean).length;
if (llm > 0 && llm < 3) fail('Для AI-помощника нужны все три строки: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL (или ни одной).');

// Secrets go through a temporary file inside the project, deleted right after.
const tmpDir = resolve(ROOT_DIR, '.tmp');
const file = resolve(tmpDir, `secrets-${process.pid}.env`);
mkdirSync(tmpDir, {recursive: true});
writeFileSync(
  file,
  Object.entries(secrets)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n',
  {mode: 0o600},
);
say(`Проект Supabase: ${ref}`);
let stored: number;
try {
  stored = runNpx([SUPABASE_CLI, 'secrets', 'set', '--env-file', file, '--project-ref', ref]);
} finally {
  // Before any exit: fail() ends the process, so it must not run inside this try.
  rmSync(file, {force: true});
}
if (stored !== 0) fail('Не удалось сохранить секреты. Если просит войти — выполните npm run cloud:login.');
ok(`секреты сервера сохранены в Supabase${llm ? ' (включая AI-помощника)' : ''}`);

// --use-api: bundling happens on Supabase's side, Docker is not needed.
const deploy = runNpx([SUPABASE_CLI, 'functions', 'deploy', 'public-api', 'owner-api', 'assistant', 'notify-dispatch', '--project-ref', ref, '--use-api']);
if (deploy !== 0) fail('Не удалось загрузить функции. Скопируйте текст ошибки выше — по нему видно, что исправить.');
ok('функции загружены');

let healthy = false;
for (let i = 0; i < 10 && !healthy; i++) {
  try {
    healthy = (await fetch(`${supabaseUrl()}/functions/v1/public-api/health`)).ok;
  } catch {
    /* retry */
  }
  if (!healthy) await new Promise((r) => setTimeout(r, 3000));
}
if (!healthy) fail('Функции загружены, но не отвечают. Supabase → Edge Functions → public-api → Logs покажет причину.');
ok('серверные функции отвечают');
say('\nДальше: npm run cloud:site');
