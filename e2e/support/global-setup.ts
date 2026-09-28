// Brings up the real stack for browser tests:
//   1. fresh PostgreSQL database cs_e2e: Supabase shim + all migrations + seed
//   2. the Edge Function handlers (same code as deployed) on FUNCTIONS_PORT
//   3. a production build of the site (shared JS/CSS + per-studio shells)
//      served with the generated Cloudflare `_redirects` / `_headers`
// Nothing is mocked: the browser talks to the functions, the functions to SQL.
import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postgres from 'postgres';
import {applyMigrations} from '../../scripts/db/migrate.mjs';
import {DIST_DIR, E2E_DB, FUNCTIONS_PORT, FUNCTIONS_URL, JWT_ISSUER, ROOT, SITE_PORT, SITE_URL, STATE_FILE, databaseUrl, type E2EState} from './env.ts';

async function waitFor(url: string, name: string, proc: ChildProcess, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`${name} exited with code ${proc.exitCode}`);
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`${name} did not start at ${url}`);
}

async function prepareDatabase() {
  const admin = postgres(databaseUrl('postgres'), {max: 1, onnotice: () => {}});
  try {
    await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${E2E_DB}'`);
    await admin.unsafe(`drop database if exists ${E2E_DB}`);
    await admin.unsafe(`create database ${E2E_DB}`);
  } finally {
    await admin.end();
  }
  const sql = postgres(databaseUrl(), {max: 1, onnotice: () => {}});
  try {
    await applyMigrations(sql, {log: () => {}});
    await sql.unsafe(readFileSync(resolve(ROOT, 'supabase/seed.sql'), 'utf8'));
  } finally {
    await sql.end();
  }
}

function build() {
  if (process.env.E2E_REUSE_DIST === '1' && existsSync(resolve(DIST_DIR, 's'))) return;
  const env = {...process.env, VITE_FUNCTIONS_URL: FUNCTIONS_URL, VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_VAPID_PUBLIC_KEY: ''};
  const run = (args: string[]) => {
    const r = spawnSync('npx', args, {cwd: ROOT, env, stdio: 'inherit'});
    if (r.status !== 0) throw new Error(`build step failed: npx ${args.join(' ')}`);
  };
  run(['vite', 'build', '--outDir', DIST_DIR, '--emptyOutDir', '--logLevel', 'warn']);
  run(['tsx', 'scripts/tenant/render-site.ts', '--out', DIST_DIR]);
}

export default async function globalSetup() {
  mkdirSync(resolve(ROOT, '.tmp'), {recursive: true});
  const state: E2EState = {authJwtSecret: randomBytes(32).toString('hex'), cronSecret: randomBytes(16).toString('hex')};
  writeFileSync(STATE_FILE, JSON.stringify(state));

  await prepareDatabase();
  build();

  const functions = spawn(
    resolve(ROOT, 'node_modules/.bin/deno'),
    ['run', '--allow-net', '--allow-env', '--allow-read', '--allow-sys', '--config', 'supabase/functions/deno.json', 'scripts/functions-dev-server.ts'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DENO_DIR: process.env.DENO_DIR,
        PORT: String(FUNCTIONS_PORT),
        SUPABASE_DB_URL: databaseUrl(),
        BOOKING_TOKEN_SECRET: randomBytes(32).toString('hex'),
        AUTH_JWT_SECRET: state.authJwtSecret,
        AUTH_JWT_ISSUER: JWT_ISSUER,
        CRON_SECRET: state.cronSecret,
        ALLOWED_ORIGINS: SITE_URL,
        // All browser requests share one local IP; limits themselves are covered by
        // the SQL and function tests, so reads get room for a whole test run.
        RL_PUBLIC_READ_PER_MIN: '1000',
        // Deliberately no LLM_* and no VAPID_*: the tests check that booking
        // works without AI and that the UI is honest about push not being set up.
      },
    },
  );
  const site = spawn('node', ['scripts/serve-dist.mjs'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {...process.env, DIST_DIR, PORT: String(SITE_PORT)},
  });
  try {
    await waitFor(`${FUNCTIONS_URL}/public-api/health`, 'functions server', functions, 120_000);
    await waitFor(`${SITE_URL}/`, 'static site', site);
  } catch (error) {
    functions.kill();
    site.kill();
    throw error;
  }
  return async () => {
    functions.kill();
    site.kill();
  };
}
