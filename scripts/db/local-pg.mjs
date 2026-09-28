#!/usr/bin/env node
// Local PostgreSQL for machines without Docker/Supabase CLI.
// Starts a throwaway cluster on 127.0.0.1:54322 (same port as `supabase start`).
// Usage: node scripts/db/local-pg.mjs start|stop|status|url
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dataDir = resolve(root, '.tmp/pg/data');
const logFile = resolve(root, '.tmp/pg/postgres.log');
const port = process.env.LOCAL_PG_PORT ?? '54322';

function findPgBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const bin = `${base}/${v}/bin`;
      if (existsSync(`${bin}/pg_ctl`)) return bin;
    }
  }
  const which = spawnSync('sh', ['-c', 'dirname "$(command -v pg_ctl)"'], {encoding: 'utf8'});
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  throw new Error('pg_ctl not found. Install PostgreSQL 15+ or set PG_BIN.');
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function run(bin, args, opts = {}) {
  const cmd = isRoot ? 'runuser' : bin;
  const fullArgs = isRoot ? ['-u', 'postgres', '--', bin, ...args] : args;
  return execFileSync(cmd, fullArgs, {stdio: 'inherit', ...opts});
}

const pgBin = findPgBin();
const command = process.argv[2] ?? 'status';

if (command === 'start') {
  if (!existsSync(`${dataDir}/PG_VERSION`)) {
    mkdirSync(dataDir, {recursive: true});
    if (isRoot) execFileSync('chown', ['-R', 'postgres:postgres', resolve(root, '.tmp/pg')]);
    const pwFile = resolve(root, '.tmp/pg/pwfile');
    writeFileSync(pwFile, 'postgres\n');
    if (isRoot) execFileSync('chown', ['postgres:postgres', pwFile]);
    run(`${pgBin}/initdb`, ['-D', dataDir, '-U', 'postgres', '--pwfile', pwFile, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C.UTF-8']);
  }
  const status = spawnSync(isRoot ? 'runuser' : `${pgBin}/pg_ctl`, isRoot ? ['-u', 'postgres', '--', `${pgBin}/pg_ctl`, '-D', dataDir, 'status'] : ['-D', dataDir, 'status']);
  if (status.status === 0) {
    console.log(`postgres already running on ${port}`);
  } else {
    run(`${pgBin}/pg_ctl`, ['-D', dataDir, '-l', logFile, '-w', '-o', `-p ${port} -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=200 -c fsync=off -c timezone=UTC`, 'start']);
  }
  console.log(`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
} else if (command === 'stop') {
  run(`${pgBin}/pg_ctl`, ['-D', dataDir, '-m', 'fast', 'stop']);
} else if (command === 'status') {
  run(`${pgBin}/pg_ctl`, ['-D', dataDir, 'status']);
} else if (command === 'url') {
  console.log(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
} else {
  console.error('Usage: local-pg.mjs start|stop|status|url');
  process.exit(2);
}
