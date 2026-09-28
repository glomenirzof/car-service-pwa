// Builds a template database once per test run (shim + all migrations);
// every test file then clones it, so files are isolated and fast.
import postgres from 'postgres';
import {applyMigrations} from '../../scripts/db/migrate.mjs';
import {adminUrl, TEMPLATE_DB} from './env.ts';

export default async function setup() {
  const admin = postgres(adminUrl(), {max: 1, onnotice: () => {}});
  try {
    await admin.unsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname like 'cs_t_%' or datname = '${TEMPLATE_DB}'`);
    const stale = await admin`select datname from pg_database where datname like 'cs_t_%'`;
    for (const row of stale) await admin.unsafe(`drop database if exists "${row.datname}"`);
    await admin.unsafe(`drop database if exists ${TEMPLATE_DB}`);
    await admin.unsafe(`create database ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  const tpl = postgres(adminUrl(TEMPLATE_DB), {max: 1, onnotice: () => {}});
  try {
    await applyMigrations(tpl, {log: () => {}});
  } finally {
    await tpl.end();
  }
}
