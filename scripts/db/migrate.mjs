#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order to DATABASE_URL.
// On plain PostgreSQL (no Supabase schemas) it first applies the Supabase shim.
// Usage: node scripts/db/migrate.mjs [--reset] [--seed]
import postgres from 'postgres';
import {readdirSync, readFileSync, existsSync, realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '../..');

export async function applyMigrations(sql, {log = console.log} = {}) {
  const hasAuth = await sql`select 1 from pg_namespace where nspname = 'auth'`;
  const hasSupabaseRoles = await sql`select 1 from pg_roles where rolname = 'supabase_admin'`;
  if (hasAuth.length === 0 || hasSupabaseRoles.length === 0) {
    await sql.unsafe(readFileSync(resolve(root, 'supabase/tests/bootstrap/supabase-shim.sql'), 'utf8'));
    log('applied supabase shim (plain PostgreSQL)');
  }
  await sql`create schema if not exists supabase_migrations`;
  await sql`create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[])`;
  const applied = new Set((await sql`select version from supabase_migrations.schema_migrations`).map((r) => r.version));
  const dir = resolve(root, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const version = file.split('_')[0];
    if (applied.has(version)) continue;
    const body = readFileSync(resolve(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into supabase_migrations.schema_migrations (version, name) values (${version}, ${file})`;
    });
    log(`applied ${file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  for (const file of ['settings.env', '.env']) {
    if (existsSync(resolve(root, file))) process.loadEnvFile(resolve(root, file));
  }
  const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
  const reset = process.argv.includes('--reset');
  const seed = process.argv.includes('--seed');
  const host = new URL(url).hostname;
  if ((reset || seed) && !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    console.error(`--reset/--seed стирают данные и добавляют демо — только для локальной базы, а DATABASE_URL указывает на ${host}.`);
    process.exit(2);
  }
  const sql = postgres(url, {onnotice: () => {}, max: 1});
  try {
    if (reset) {
      await sql.unsafe('drop schema if exists app cascade; drop schema if exists supabase_migrations cascade;');
      console.log('dropped schema app');
    }
    await applyMigrations(sql);
    if (seed) {
      const seedFile = resolve(root, 'supabase/seed.sql');
      if (existsSync(seedFile)) {
        await sql.unsafe(readFileSync(seedFile, 'utf8'));
        console.log('applied supabase/seed.sql');
      }
    }
  } finally {
    await sql.end();
  }
}
