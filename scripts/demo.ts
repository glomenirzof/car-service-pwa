#!/usr/bin/env tsx
// npm run demo — the whole app on this computer; only Node.js has to be installed.
//   * PostgreSQL 17 from npm (embedded-postgres), data in .tmp/demo/pg
//   * a fresh database with every migration and the demo studios (seed)
//   * the Edge Function handlers (Deno from npm) on 127.0.0.1:54341
//   * the site (Vite dev server), opened in the browser
// Owner cabinet without a password: /__demo/owner/<slug> (dev server only,
// local database only). Ctrl+C stops everything. Secrets are random per run
// and never written to disk.
import {spawn, type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseEnv, stripVTControlCharacters} from 'node:util';
import {dirname, join, resolve} from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';
import {createServer, type ViteDevServer} from 'vite';
import {applyMigrations} from './db/migrate.mjs';
import {listTenantSlugs, loadTenantOrThrow} from './tenant/lib/load.ts';
import {generateTenantAssets} from './tenant/lib/assets.ts';
import {configHash} from './tenant/lib/payload.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PG_PORT = Number(process.env.DEMO_PG_PORT ?? 54340);
const FN_PORT = Number(process.env.DEMO_FUNCTIONS_PORT ?? 54341);
const DATA_DIR = resolve(ROOT, '.tmp/demo/pg');
const DB_NAME = 'demo';
const dbUrl = (db: string) => `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/${db}`;

const say = (s: string) => console.log(s);
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let pg: EmbeddedPostgres | null = null;
let functions: ChildProcess | null = null;
let site: ViteDevServer | null = null;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  say('\nОстанавливаю…');
  await site?.close().catch(() => undefined);
  functions?.kill();
  await pg?.stop().catch(() => undefined);
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

async function startDatabase() {
  say('1/4 База данных (PostgreSQL 17)…');
  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PG_PORT,
    persistent: true,
    // Unicode-aware lower()/ilike for Cyrillic on every OS, independent of the system locale.
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8'],
    // PostgreSQL refuses to run as root (containers); a normal user never needs this.
    createPostgresUser: isRoot,
    onLog: () => undefined,
    onError: (e) => {
      if (!stopping) console.error(String(e instanceof Error ? e.message : e).trim());
    },
  });
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    mkdirSync(resolve(DATA_DIR, '..'), {recursive: true});
    await pg.initialise();
  }
  await pg.start();

  const admin = postgres(dbUrl('postgres'), {max: 1, onnotice: () => undefined});
  try {
    await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
    await admin.unsafe(`create database ${DB_NAME}`);
  } finally {
    await admin.end();
  }
  const sql = postgres(dbUrl(DB_NAME), {max: 1, onnotice: () => undefined});
  try {
    await applyMigrations(sql, {log: () => undefined});
    await sql.unsafe(readFileSync(resolve(ROOT, 'supabase/seed.sql'), 'utf8'));
  } finally {
    await sql.end();
  }
}

async function startFunctions(secrets: {token: string; jwt: string; cron: string}) {
  say('2/4 Серверные функции…');
  // The deno binary itself, not the npm wrapper (bin.cjs does not pass signals on,
  // so the server would outlive Ctrl+C). The wrapper only if the binary is missing.
  const denoPkg = dirname(createRequire(import.meta.url).resolve('deno/package.json'));
  const denoExe = join(denoPkg, process.platform === 'win32' ? 'deno.exe' : 'deno');
  const [command, prefix] = existsSync(denoExe) ? [denoExe, []] : [process.execPath, [join(denoPkg, 'bin.cjs')]];
  const passthrough = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => /^(LLM_|PATH$|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$|SYSTEMROOT$|DENO_DIR$|HTTPS?_PROXY$|NO_PROXY$)/i.test(k)),
  );
  // The AI assistant also works in the demo when settings.env has the LLM_* lines filled in.
  const settingsFile = resolve(ROOT, 'settings.env');
  if (existsSync(settingsFile)) {
    for (const [k, v] of Object.entries(parseEnv(readFileSync(settingsFile, 'utf8')))) {
      if (k.startsWith('LLM_') && v) passthrough[k] = v;
    }
  }
  functions = spawn(
    command,
    [...prefix, 'run', '--allow-net', '--allow-env', '--allow-read', '--allow-sys', '--config', 'supabase/functions/deno.json', 'scripts/functions-dev-server.ts'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...passthrough,
        DENO_NO_UPDATE_CHECK: '1',
        PORT: String(FN_PORT),
        SUPABASE_DB_URL: dbUrl(DB_NAME),
        BOOKING_TOKEN_SECRET: secrets.token,
        AUTH_JWT_SECRET: secrets.jwt,
        AUTH_JWT_ISSUER: `http://127.0.0.1:${FN_PORT}/auth/v1`,
        CRON_SECRET: secrets.cron,
      },
    },
  );
  // Hide Deno's dependency download progress; show real errors.
  functions.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      const clean = stripVTControlCharacters(line).trim();
      // Expected locally: there is no proxy that would pass the client IP.
      if (clean && !/^(Download|Initialize|Warning The `--env-file`)|no client IP header/.test(clean)) console.error(`  [функции] ${clean}`);
    }
  });
  functions.on('exit', (code) => {
    if (!stopping) {
      console.error(`Серверные функции остановились (код ${code}).`);
      void stop(1);
    }
  });
  // The first start downloads the functions' dependencies, which can take a minute.
  const url = `http://127.0.0.1:${FN_PORT}/functions/v1/public-api/health`;
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('серверные функции не запустились за 5 минут');
}

async function startSite(secrets: {jwt: string}) {
  say('3/4 Картинки и иконки студий…');
  for (const slug of listTenantSlugs()) {
    const cfg = loadTenantOrThrow(slug);
    await generateTenantAssets(cfg, resolve(ROOT, '.generated/site'), configHash(cfg));
  }
  say('4/4 Сайт…');
  // Process env wins over .env files: the demo never talks to a real Supabase project.
  Object.assign(process.env, {
    VITE_FUNCTIONS_URL: `http://127.0.0.1:${FN_PORT}/functions/v1`,
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_PUBLISHABLE_KEY: '',
    VITE_VAPID_PUBLIC_KEY: '',
    VITE_STORAGE_PUBLIC_URL: '',
    DEMO_OWNER_DATABASE_URL: dbUrl(DB_NAME),
    DEMO_OWNER_JWT_SECRET: secrets.jwt,
    DEMO_OWNER_JWT_ISSUER: `http://127.0.0.1:${FN_PORT}/auth/v1`,
  });
  const first = listTenantSlugs()[0] ?? 'graphite';
  site = await createServer({
    configFile: resolve(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'warn',
    // forwardConsole: false — browser console warnings stay in the browser, not in this window.
    server: {host: '127.0.0.1', strictPort: false, forwardConsole: false, open: process.env.DEMO_NO_OPEN ? false : `/s/${first}/`},
  });
  await site.listen();
  return site.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? 'http://127.0.0.1:5173';
}

try {
  say('Запускаю демо. Первый запуск занимает 1–3 минуты.\n');
  const secrets = {token: randomBytes(32).toString('hex'), jwt: randomBytes(32).toString('hex'), cron: randomBytes(16).toString('hex')};
  await startDatabase();
  await startFunctions(secrets);
  const base = await startSite(secrets);
  const slugs = listTenantSlugs();
  const width = Math.max(...slugs.map((s) => loadTenantOrThrow(s).name.length));
  say('\nГотово. Откройте в браузере:\n');
  for (const slug of slugs) {
    const name = loadTenantOrThrow(slug).name.padEnd(width);
    say(`  ${name}  клиенты:  ${base}/s/${slug}/`);
    say(`  ${' '.repeat(width)}  кабинет:  ${base}/__demo/owner/${slug}`);
  }
  say('\nВход в кабинет по ссылке без пароля работает только в демо на этом компьютере.');
  say('Демо-данные создаются заново при каждом запуске.');
  say('Чтобы остановить — нажмите Ctrl+C в этом окне.\n');
} catch (error) {
  console.error(`\nНе получилось запустить демо: ${(error as Error).message}`);
  await stop(1);
}
