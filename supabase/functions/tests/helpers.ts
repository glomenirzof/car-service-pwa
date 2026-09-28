// Test harness for Edge Functions: a fresh PostgreSQL database per test run
// (Supabase shim + all migrations), fixture studios, JWT minting, and local
// fakes for the two external services (OpenAI-compatible LLM, Web Push service).
import postgres from 'postgres';
import {SignJWT} from 'jose';
import {fixtureConfig} from '../../../tests/fixtures/business.ts';
import {buildPublishPayload, configHash} from '../../../scripts/tenant/lib/payload.ts';
import type {BusinessConfigInput} from '../_shared/core/tenant-config.ts';

const ROOT = new URL('../../../', import.meta.url);
export const JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters!!';

Deno.env.set('BOOKING_TOKEN_SECRET', 'test-booking-token-secret-0123456789abcdef');
Deno.env.set('AUTH_JWT_SECRET', JWT_SECRET);
Deno.env.set('AUTH_JWT_ISSUER', 'http://auth.test/auth/v1');
Deno.env.set('CRON_SECRET', 'test-cron-secret');

export const test = (name: string, fn: () => Promise<void>) =>
  Deno.test({name, fn, sanitizeOps: false, sanitizeResources: false});

let setup: Promise<{sql: postgres.Sql; url: string}> | null = null;

export function database() {
  setup ??= (async () => {
    const admin = new URL(Deno.env.get('DATABASE_URL') ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres');
    const name = `cs_fn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const a = postgres(admin.toString(), {max: 1, onnotice: () => {}});
    await a.unsafe(`create database ${name}`);
    await a.end();
    const url = new URL(admin);
    url.pathname = `/${name}`;
    const sql = postgres(url.toString(), {max: 4, onnotice: () => {}});
    await sql.unsafe(await Deno.readTextFile(new URL('supabase/tests/bootstrap/supabase-shim.sql', ROOT)));
    const dir = new URL('supabase/migrations/', ROOT);
    const files = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith('.sql')).sort();
    for (const f of files) await sql.unsafe(await Deno.readTextFile(new URL(f, dir)));
    Deno.env.set('SUPABASE_DB_URL', url.toString());
    globalThis.addEventListener('unload', () => {
      // best effort: the database is dropped by the next run's cleanup
    });
    return {sql, url: url.toString()};
  })();
  return setup;
}

export async function publish(overrides: Partial<BusinessConfigInput> = {}) {
  const {sql} = await database();
  const cfg = fixtureConfig(overrides);
  const payload = buildPublishPayload(cfg);
  const [row] = await sql`select app.publish_tenant(${sql.json(payload as never)}, ${configHash(cfg)}) as r`;
  const tenantId = (row!.r as {tenantId: string}).tenantId;
  const services = await sql`select id, key from app.services where tenant_id = ${tenantId}`;
  const resources = await sql`select id, key from app.resources where tenant_id = ${tenantId}`;
  return {
    cfg,
    tenantId,
    service: Object.fromEntries(services.map((r) => [r.key, r.id])) as Record<string, string>,
    resource: Object.fromEntries(resources.map((r) => [r.key, r.id])) as Record<string, string>,
  };
}

export async function makeLive(slug: string) {
  const {sql} = await database();
  const owner = await createOwner(slug);
  await sql`select app.activate_tenant(${slug})`;
  return owner;
}

export async function createOwner(slug: string) {
  const {sql} = await database();
  const id = crypto.randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${`${id}@owner.test`})`;
  await sql`select app.add_member(${slug}, ${id}, 'owner')`;
  return id;
}

export async function mintJwt(sub: string, opts: {expiresIn?: string; role?: string; secret?: string} = {}) {
  return new SignJWT({role: opts.role ?? 'authenticated', email: `${sub}@owner.test`})
    .setProtectedHeader({alg: 'HS256'})
    .setSubject(sub)
    .setAudience('authenticated')
    .setIssuer('http://auth.test/auth/v1')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(opts.secret ?? JWT_SECRET));
}

/** Wall-clock moment in the studio timezone, N days from today (from the database clock). */
export async function localMoment(tz: string, days: number, time: string): Promise<string> {
  const {sql} = await database();
  const [r] = await sql`select ((((now() at time zone ${tz})::date + ${days}::int) + ${time}::time) at time zone ${tz}) as at`;
  return (r!.at as Date).toISOString();
}

export async function localDate(tz: string, days: number): Promise<string> {
  const {sql} = await database();
  const [r] = await sql`select to_char((now() at time zone ${tz})::date + ${days}::int, 'YYYY-MM-DD') as d`;
  return r!.d as string;
}

export function request(fn: string, path: string, init: RequestInit & {json?: unknown; ip?: string} = {}) {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  headers.set('x-forwarded-for', init.ip ?? '203.0.113.10');
  return new Request(`http://functions.test/functions/v1/${fn}${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

// ---------------------------------------------------------------------------
// Fake OpenAI-compatible LLM: a scripted local HTTP server. It is a test double
// for the provider, not an "integration"; real-provider calls are listed as
// pending external checks in ACCEPTANCE.md.
// ---------------------------------------------------------------------------

export type LlmCall = {messages: {role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string}[]; tools?: {function: {name: string}}[]; tool_choice?: string};
export type LlmScript = (call: LlmCall, index: number) => {status?: number; body?: unknown} | Record<string, unknown>;

export function fakeLlm(script: LlmScript) {
  const calls: LlmCall[] = [];
  const server = Deno.serve({port: 0, hostname: '127.0.0.1', onListen: () => {}}, async (req) => {
    const call = (await req.json()) as LlmCall;
    calls.push(call);
    const out = script(call, calls.length - 1) as {status?: number; body?: unknown};
    if (out.status && out.status !== 200) return new Response(JSON.stringify(out.body ?? {error: 'fail'}), {status: out.status});
    const message = 'body' in out ? out.body : out;
    return Response.json({id: 'x', object: 'chat.completion', choices: [{index: 0, message, finish_reason: 'stop'}], usage: {total_tokens: 100}});
  });
  const url = `http://127.0.0.1:${server.addr.port}/v1`;
  Deno.env.set('LLM_BASE_URL', url);
  Deno.env.set('LLM_API_KEY', 'test-key');
  Deno.env.set('LLM_MODEL', 'test-model');
  return {calls, url, close: () => server.shutdown()};
}

export function toolCall(name: string, args: unknown, id = crypto.randomUUID()) {
  return {role: 'assistant', content: null, tool_calls: [{id, type: 'function', function: {name, arguments: JSON.stringify(args)}}]};
}

export function text(content: string) {
  return {role: 'assistant', content};
}

// ---------------------------------------------------------------------------
// Local HTTPS "push service" with a throwaway self-signed certificate.
// ---------------------------------------------------------------------------

export async function selfSignedCert() {
  const dir = await Deno.makeTempDir();
  const cmd = new Deno.Command('openssl', {
    args: ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', `${dir}/key.pem`, '-out', `${dir}/cert.pem`, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
    stdout: 'null',
    stderr: 'piped',
  });
  const out = await cmd.output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return {cert: await Deno.readTextFile(`${dir}/cert.pem`), key: await Deno.readTextFile(`${dir}/key.pem`)};
}

export type PushReceived = {path: string; headers: Headers; body: Uint8Array};

export async function fakePushService(statusFor: (path: string) => number = () => 201) {
  const {cert, key} = await selfSignedCert();
  const received: PushReceived[] = [];
  const server = Deno.serve({port: 0, hostname: '127.0.0.1', cert, key, onListen: () => {}}, async (req) => {
    const path = new URL(req.url).pathname;
    received.push({path, headers: new Headers(req.headers), body: new Uint8Array(await req.arrayBuffer())});
    return new Response(null, {status: statusFor(path)});
  });
  return {origin: `https://127.0.0.1:${server.addr.port}`, received, close: () => server.shutdown()};
}
