#!/usr/bin/env tsx
// npm run cloud:live — switches a studio from demo (preview) to working mode:
// checks the settings (owner, hours, phone, address, bookable service), removes
// demo bookings and turns on real notifications. Asks instead of taking flags.
import {createInterface} from 'node:readline';
import postgres from 'postgres';
import {listTenantSlugs, loadTenantOrThrow} from '../tenant/lib/load.ts';
import {fail, ok, openSettings, requireSettings, say, setting} from './common.ts';

openSettings();
requireSettings('DATABASE_URL');

const slugs = listTenantSlugs();
const lines = createInterface({input: process.stdin, terminal: false})[Symbol.asyncIterator]();
const ask = async (prompt: string) => {
  process.stdout.write(prompt);
  const next = await lines.next();
  return next.done ? '' : String(next.value).trim();
};

say('Какую студию перевести в рабочий режим?');
slugs.forEach((slug, i) => say(`  ${i + 1}. ${loadTenantOrThrow(slug).name} (${slug})`));
const pick = await ask('Номер студии: ');
const slug = slugs[Number(pick) - 1] ?? (slugs.includes(pick) ? pick : undefined);
if (!slug) fail('Нет студии с таким номером.');
say('Демо-записи этой студии будут удалены, клиенты и владелец начнут получать уведомления.');
if (!/^(да|д|yes|y)$/i.test(await ask('Продолжить? Напишите «да»: '))) fail('Отменено, ничего не изменилось.');

const sql = postgres(setting('DATABASE_URL')!, {max: 1, prepare: false, onnotice: () => undefined});
try {
  const [rd] = await sql`select app.tenant_readiness(${slug}) as r`;
  const readiness = rd!.r as {ready: boolean; problems: string[]; status: string};
  if (readiness.status === 'live') {
    ok('студия уже работает в рабочем режиме');
  } else if (!readiness.ready) {
    fail(`Пока нельзя, не хватает:\n  - ${readiness.problems.map((p) => p.replace('npm run owner:invite', 'npm run cloud:owner')).join('\n  - ')}`);
  } else {
    const [act] = await sql`select app.activate_tenant(${slug}) as r`;
    ok(`студия «${loadTenantOrThrow(slug).name}» работает; удалено демо-записей: ${(act!.r as {demoBookingsRemoved: number}).demoBookingsRemoved}`);
  }
} finally {
  await sql.end({timeout: 5});
}
