#!/usr/bin/env tsx
// npm run cloud:owner — gives a person access to a studio's cabinet. Asks
// questions instead of taking flags (PowerShell drops `--` in `npm run x -- …`).
// Running it again for the same email sets a new password.
import {createInterface} from 'node:readline';
import postgres from 'postgres';
import {listTenantSlugs, loadTenantOrThrow} from '../tenant/lib/load.ts';
import {adminClient, grantOwner} from '../tenant/lib/owners.ts';
import {fail, ok, openSettings, requireSettings, say, setting, supabaseUrl} from './common.ts';

openSettings();
requireSettings('SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DATABASE_URL');

const slugs = listTenantSlugs();
const rl = createInterface({input: process.stdin, terminal: false});
const lines = rl[Symbol.asyncIterator]();
// Line iterator instead of rl.question(): no answers are lost when they arrive together (pasted or piped).
const ask = async (prompt: string) => {
  process.stdout.write(prompt);
  const next = await lines.next();
  return next.done ? '' : String(next.value);
};
say('Для какой студии выдать доступ к кабинету?');
slugs.forEach((slug, i) => say(`  ${i + 1}. ${loadTenantOrThrow(slug).name} (${slug})`));
const pick = (await ask('Номер студии: ')).trim();
const slug = slugs[Number(pick) - 1] ?? (slugs.includes(pick) ? pick : undefined);
if (!slug) fail('Нет студии с таким номером.');
const email = (await ask('Почта владельца (ей он будет входить): ')).trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Это не похоже на адрес почты.');
const password = await ask('Пароль для входа (не короче 8 символов; виден на экране — проверьте, что рядом никого нет): ');
rl.close();
if (password.length < 8) fail('Пароль короче 8 символов.');

const sql = postgres(setting('DATABASE_URL')!, {max: 1, prepare: false, onnotice: () => undefined});
try {
  const r = await grantOwner({sql, admin: adminClient(supabaseUrl(), setting('SUPABASE_SECRET_KEY')!), tenant: slug, email, password});
  ok(`${email}: ${r.account === 'created' ? 'аккаунт создан' : 'пароль обновлён'}, доступ к кабинету «${loadTenantOrThrow(slug).name}» выдан`);
  const site = setting('SITE_URL');
  if (site) say(`Вход в кабинет: ${site}/s/${slug}/owner/`);
} catch (error) {
  fail(`Не получилось: ${(error as Error).message}`);
} finally {
  await sql.end({timeout: 5});
}
