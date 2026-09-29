// Ports and URLs of the isolated E2E stack (separate database, function server
// and static site, so a test run never touches the development database).
import {resolve} from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const E2E_DB = 'cs_e2e';
export const FUNCTIONS_PORT = Number(process.env.E2E_FUNCTIONS_PORT ?? 54331);
export const SITE_PORT = Number(process.env.E2E_SITE_PORT ?? 4183);
export const SITE_URL = `http://127.0.0.1:${SITE_PORT}`;
export const FUNCTIONS_URL = `http://127.0.0.1:${FUNCTIONS_PORT}/functions/v1`;
export const DIST_DIR = resolve(ROOT, '.tmp/e2e-dist');
export const STATE_FILE = resolve(ROOT, '.tmp/e2e-state.json');
export const JWT_ISSUER = `http://127.0.0.1:${FUNCTIONS_PORT}/auth/v1`;

export function databaseUrl(database = E2E_DB): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres');
  url.pathname = `/${database}`;
  return url.toString();
}

/** Secrets generated per run by global setup and shared with the tests. */
export type E2EState = {authJwtSecret: string; cronSecret: string};
