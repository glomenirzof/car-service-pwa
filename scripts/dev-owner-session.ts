#!/usr/bin/env tsx
// LOCAL DEVELOPMENT / E2E ONLY — never against production.
// Without the Supabase Auth server (no Docker), creates an owner in the local
// PostgreSQL (auth.users shim + membership) and prints a session signed with
// AUTH_JWT_SECRET, which the local functions server verifies. Paste the JSON
// into localStorage["sb-owner-<slug>"] or let Playwright inject it.
// Usage: tsx scripts/dev-owner-session.ts --slug graphite [--email owner@local.test]
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {SignJWT} from 'jose';
import postgres from 'postgres';

export async function localOwnerSession(opts: {databaseUrl: string; secret: string; issuer: string; slug: string; email: string}) {
  const sql = postgres(opts.databaseUrl, {max: 1, onnotice: () => {}});
  try {
    const host = new URL(opts.databaseUrl).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('dev-owner-session is for a local database only');
    const existing = await sql`select id from auth.users where email = ${opts.email}`;
    const id = (existing[0]?.id as string) ?? randomUUID();
    if (!existing.length) await sql`insert into auth.users (id, email) values (${id}, ${opts.email})`;
    await sql`select app.add_member(${opts.slug}, ${id}, 'owner')`;
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 8 * 3600;
    const accessToken = await new SignJWT({role: 'authenticated', email: opts.email, aal: 'aal1', session_id: randomUUID()})
      .setProtectedHeader({alg: 'HS256', typ: 'JWT'})
      .setSubject(id)
      .setAudience('authenticated')
      .setIssuer(opts.issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn)
      .sign(new TextEncoder().encode(opts.secret));
    return {
      userId: id,
      storageKey: `sb-owner-${opts.slug}`,
      session: {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: expiresIn,
        expires_at: now + expiresIn,
        refresh_token: `local-${randomUUID()}`,
        user: {id, aud: 'authenticated', role: 'authenticated', email: opts.email, app_metadata: {provider: 'email'}, user_metadata: {}, created_at: new Date().toISOString()},
      },
    };
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const {values} = parseArgs({options: {slug: {type: 'string', default: 'graphite'}, email: {type: 'string', default: 'owner@local.test'}}});
  const r = await localOwnerSession({
    databaseUrl: process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    secret: process.env.AUTH_JWT_SECRET ?? '',
    issuer: process.env.AUTH_JWT_ISSUER ?? 'http://127.0.0.1:54321/auth/v1',
    slug: values.slug!,
    email: values.email!,
  });
  if (!process.env.AUTH_JWT_SECRET) throw new Error('AUTH_JWT_SECRET is required (same value as the local functions server)');
  console.log(`localStorage.setItem(${JSON.stringify(r.storageKey)}, ${JSON.stringify(JSON.stringify(r.session))})`);
}
