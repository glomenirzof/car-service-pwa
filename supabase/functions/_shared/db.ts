// Direct Postgres access from Edge Functions (SUPABASE_DB_URL).
// Every request runs in a transaction that first switches to the role the
// caller is entitled to, exactly like PostgREST does:
//   anon           public client API (SECURITY DEFINER public_* functions only)
//   authenticated  owner API, with verified JWT claims so auth.uid() and RLS work
//   service_role   notification worker / housekeeping
import postgres from 'postgres';
import {databaseUrl} from './env.ts';
import {HttpError} from './http.ts';

type Sql = ReturnType<typeof postgres>;
export type Tx = postgres.TransactionSql;

let client: Sql | null = null;

export function db(): Sql {
  if (!client) {
    client = postgres(databaseUrl(), {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // transaction pooler (Supavisor) compatible
      onnotice: () => {},
      connection: {application_name: 'edge-functions'},
    });
  }
  return client;
}

export async function closeDb() {
  if (client) {
    const c = client;
    client = null;
    await c.end({timeout: 5});
  }
}

export type Claims = {sub: string; role: 'authenticated'; email?: string; [k: string]: unknown};

export async function asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return mapDbErrors(() =>
    db().begin(async (tx) => {
      await tx`set local role anon`;
      await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true)`;
      return fn(tx);
    }) as Promise<T>,
  );
}

export async function asUser<T>(claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return mapDbErrors(() =>
    db().begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      return fn(tx);
    }) as Promise<T>,
  );
}

export async function asService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return mapDbErrors(() =>
    db().begin(async (tx) => {
      await tx`set local role service_role`;
      return fn(tx);
    }) as Promise<T>,
  );
}

const STATUS: Record<string, number> = {
  not_found: 404,
  tenant_unavailable: 404,
  forbidden: 403,
  unauthenticated: 401,
  invalid_input: 400,
  slot_unavailable: 409,
  conflict: 409,
  invalid_state: 409,
  too_late: 409,
  idempotency_conflict: 409,
  not_ready: 409,
};

export async function mapDbErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const e = error as {code?: string; message?: string; detail?: string};
    if (e.code === 'P0001' && e.message && STATUS[e.message]) {
      let detail: unknown = e.detail;
      try {
        detail = e.detail ? JSON.parse(e.detail) : undefined;
      } catch {
        /* plain text detail */
      }
      throw new HttpError(STATUS[e.message]!, e.message, e.message, detail);
    }
    if (e.code === '42501') throw new HttpError(403, 'forbidden', 'permission denied');
    if (e.code === '22P02' || e.code === '22007' || e.code === '22008') throw new HttpError(400, 'invalid_input', e.message);
    throw error;
  }
}

/** One-row jsonb result helper: select app.fn(...) as r */
export function one<T>(rows: readonly {r: unknown}[]): T {
  return rows[0]!.r as T;
}
