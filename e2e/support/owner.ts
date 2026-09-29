import {readFileSync} from 'node:fs';
import type {Page} from '@playwright/test';
import {localOwnerSession} from '../../scripts/dev-owner-session.ts';
import {JWT_ISSUER, STATE_FILE, databaseUrl, type E2EState} from './env.ts';

/**
 * Signs an owner in without the hosted Auth server: creates the user and the
 * studio membership in the E2E database and stores a session signed with the
 * run's JWT secret — the function server verifies it exactly like a GoTrue token.
 */
export async function signInOwner(page: Page, slug: string, email = `owner-${slug}@e2e.test`) {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;
  const r = await localOwnerSession({databaseUrl: databaseUrl(), secret: state.authJwtSecret, issuer: JWT_ISSUER, slug, email});
  await page.goto('/');
  await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [r.storageKey, JSON.stringify(r.session)]);
  return r;
}
