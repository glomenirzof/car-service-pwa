// Grants cabinet access: a Supabase Auth user (Admin API, server-side key) plus
// membership in app.tenant_members. There is no public sign-up; this is the way in.
import {createClient} from '@supabase/supabase-js';
import type postgres from 'postgres';

export type GrantResult = {userId: string; account: 'created' | 'invited' | 'password-updated' | 'existing'};

export function adminClient(url: string, key: string) {
  return createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
}

export async function grantOwner(opts: {
  sql: postgres.Sql;
  admin: ReturnType<typeof adminClient>;
  tenant: string;
  email: string;
  password?: string;
  role?: string;
  redirectOrigin?: string;
}): Promise<GrantResult> {
  const {sql, admin, tenant, email, password} = opts;
  const existing = await sql<{id: string}[]>`select id from auth.users where lower(email) = lower(${email})`;
  let userId = existing[0]?.id;
  let account: GrantResult['account'] = 'existing';
  if (userId && password) {
    const {error} = await admin.auth.admin.updateUserById(userId, {password});
    if (error) throw error;
    account = 'password-updated';
  } else if (!userId && password) {
    const {data, error} = await admin.auth.admin.createUser({email, password, email_confirm: true});
    if (error) throw error;
    userId = data.user.id;
    account = 'created';
  } else if (!userId) {
    const redirectTo = opts.redirectOrigin ? `${opts.redirectOrigin}/s/${tenant}/owner/` : undefined;
    const {data, error} = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? {redirectTo} : undefined);
    if (error) throw error;
    userId = data.user.id;
    account = 'invited';
  }
  await sql`select app.add_member(${tenant}, ${userId!}, ${opts.role ?? 'owner'})`;
  return {userId: userId!, account};
}
