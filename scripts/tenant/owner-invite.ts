#!/usr/bin/env tsx
// npm run owner:invite -- --tenant <slug> --email owner@example.com [--password ...] [--role owner|staff]
// Creates (or reuses) a Supabase Auth user with the Admin API and adds tenant
// membership. There is no public owner sign-up: this script is the only way in.
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server-side only) and DATABASE_URL.
import {parseArgs} from 'node:util';
import {adminClient, grantOwner} from './lib/owners.ts';
import {connect} from './lib/db.ts';
import {loadSettings} from '../lib/settings.ts';

loadSettings();

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
  console.error('Нужны SUPABASE_URL и SUPABASE_SECRET_KEY (или SUPABASE_SERVICE_ROLE_KEY) — впишите их в settings.env. Эти ключи не должны попадать в браузер.');
  process.exit(2);
}
const admin = adminClient(url, key);
const sql = connect();
try {
  const r = await grantOwner({sql, admin, tenant: values.tenant, email: values.email, password: values.password, role: values.role, redirectOrigin: values['redirect-origin']});
  const account = {created: 'создан пользователь', invited: 'приглашение отправлено на почту', 'password-updated': 'пароль обновлён', existing: 'пользователь уже был'}[r.account];
  console.log(`${values.email}: ${account}; доступ к кабинету ${values.tenant} выдан.`);
} finally {
  await sql.end();
}
