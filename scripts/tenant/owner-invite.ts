#!/usr/bin/env tsx
// npm run owner:invite -- --tenant <slug> --email owner@example.com [--password ...] [--role owner|staff]
// Creates (or reuses) a Supabase Auth user with the Admin API and adds tenant
// membership. There is no public owner sign-up: this script is the only way in.
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server-side only) and DATABASE_URL.
import {parseArgs} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {connect} from './lib/db.ts';

const {values} = parseArgs({
  options: {
    tenant: {type: 'string'},
    email: {type: 'string'},
    password: {type: 'string'},
    role: {type: 'string', default: 'owner'},
    'redirect-origin': {type: 'string'},
  },
});
if (!values.tenant || !values.email) {
  console.error('usage: npm run owner:invite -- --tenant <slug> --email <email> [--password <pw>]');
  process.exit(2);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (или SUPABASE_SECRET_KEY). Эти ключи не должны попадать в браузер.');
  process.exit(2);
}
const admin = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
const sql = connect();
try {
  const existing = await sql`select id from auth.users where lower(email) = lower(${values.email})`;
  let userId: string | undefined = existing[0]?.id;
  if (!userId) {
    if (values.password) {
      const {data, error} = await admin.auth.admin.createUser({email: values.email, password: values.password, email_confirm: true});
      if (error) throw error;
      userId = data.user.id;
      console.log(`Создан пользователь ${values.email}`);
    } else {
      const redirectTo = values['redirect-origin'] ? `${values['redirect-origin']}/s/${values.tenant}/owner/` : undefined;
      const {data, error} = await admin.auth.admin.inviteUserByEmail(values.email, redirectTo ? {redirectTo} : undefined);
      if (error) throw error;
      userId = data.user.id;
      console.log(`Приглашение отправлено на ${values.email}`);
    }
  } else {
    console.log(`Пользователь ${values.email} уже существует`);
  }
  const [row] = await sql`select app.add_member(${values.tenant}, ${userId!}, ${values.role!}) as r`;
  console.log(`Доступ к кабинету: ${JSON.stringify(row!.r)}`);
} finally {
  await sql.end();
}
