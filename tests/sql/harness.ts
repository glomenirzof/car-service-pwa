import postgres, {type Sql, type TransactionSql} from 'postgres';
import {randomUUID, createHash, randomBytes} from 'node:crypto';
import {adminUrl, TEMPLATE_DB} from './env.ts';
import {buildPublishPayload, configHash} from '../../scripts/tenant/lib/payload.ts';
import type {BusinessConfig} from '../../supabase/functions/_shared/tenant-config.ts';

export type TestDb = {sql: Sql; name: string; close: () => Promise<void>};

export async function openTestDb(): Promise<TestDb> {
  const name = `cs_t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = postgres(adminUrl(), {max: 1, onnotice: () => {}});
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.unsafe(`create database ${name} template ${TEMPLATE_DB}`);
        break;
      } catch (error) {
        if (attempt > 20 || !String(error).includes('being accessed')) throw error;
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
      }
    }
  } finally {
    await admin.end();
  }
  const sql = postgres(adminUrl(name), {max: 12, onnotice: () => {}, idle_timeout: 5});
  return {
    sql,
    name,
    close: async () => {
      await sql.end({timeout: 5});
      const a = postgres(adminUrl(), {max: 1, onnotice: () => {}});
      try {
        await a.unsafe(`drop database if exists ${name} with (force)`);
      } finally {
        await a.end();
      }
    },
  };
}

export async function publish(sql: Sql, cfg: BusinessConfig) {
  const payload = buildPublishPayload(cfg);
  const [row] = await sql`select app.publish_tenant(${sql.json(payload as never)}, ${configHash(cfg)}) as r`;
  return row!.r as {tenantId: string; slug: string; status: string; created: boolean; services: Record<string, number>};
}

export async function catalog(sql: Sql, tenantId: string) {
  const services = await sql`select id, key from app.services where tenant_id = ${tenantId}`;
  const resources = await sql`select id, key from app.resources where tenant_id = ${tenantId}`;
  return {
    service: Object.fromEntries(services.map((r) => [r.key as string, r.id as string])) as Record<string, string>,
    resource: Object.fromEntries(resources.map((r) => [r.key as string, r.id as string])) as Record<string, string>,
  };
}

/** Local wall-clock moment in the tenant timezone, N days from today. */
export async function localMoment(sql: Sql, tz: string, daysFromToday: number, time: string): Promise<Date> {
  const [row] = await sql`
    select (((now() at time zone ${tz})::date + ${daysFromToday}::int) + ${time}::time) at time zone ${tz} as at`;
  return row!.at as Date;
}

export async function localDate(sql: Sql, tz: string, daysFromToday: number): Promise<string> {
  const [row] = await sql`select to_char((now() at time zone ${tz})::date + ${daysFromToday}::int, 'YYYY-MM-DD') as d`;
  return row!.d as string;
}

export function newToken() {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest();
  return {token, hash};
}

export type BookingInput = {
  slug: string;
  serviceId: string;
  start: Date;
  name?: string;
  phone?: string;
  key?: string;
  tokenHash?: Buffer;
};

/** Public booking exactly as the Edge Function performs it: role anon. */
export async function publicBook(sql: Sql, input: BookingInput) {
  return asAnon(sql, async (tx) => {
    const [row] = await tx`
      select app.public_create_booking(
        ${input.slug}, ${input.serviceId}, ${input.start}, ${input.name ?? 'Test Client'},
        ${input.phone ?? '+79990000001'}, ${'Test car'}, ${'A001AA'}, ${null},
        ${input.key ?? randomUUID()}, ${input.tokenHash ?? newToken().hash}) as r`;
    return row!.r as {booking: {id: string; status: string; startAt: string; price: {amount: number}}; replayed: boolean};
  });
}

export async function asAnon<T>(sql: Sql, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role anon`;
    await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
    return fn(tx);
  }) as Promise<T>;
}

export async function asUser<T>(sql: Sql, userId: string, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({sub: userId, role: 'authenticated'})}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

export async function createOwner(sql: Sql, slug: string, email = `${randomUUID()}@example.test`) {
  const id = randomUUID();
  await sql`insert into auth.users (id, email) values (${id}, ${email})`;
  await sql`select app.add_member(${slug}, ${id}, 'owner')`;
  return id;
}

export async function expectDbError(promise: Promise<unknown>, message: string) {
  try {
    await promise;
  } catch (error) {
    const msg = (error as {message?: string}).message ?? String(error);
    if (msg !== message && !msg.includes(message)) {
      throw new Error(`expected DB error "${message}", got "${msg}"`, {cause: error});
    }
    return error as {message: string; detail?: string; code?: string};
  }
  throw new Error(`expected DB error "${message}", but the call succeeded`);
}
