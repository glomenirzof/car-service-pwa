#!/usr/bin/env tsx
// npm run tenant:validate -- <slug>   |   npm run tenant:validate -- --all
import {parseArgs} from 'node:util';
import {checkTenant, printReport} from './lib/checks.ts';
import {listTenantSlugs} from './lib/load.ts';

const {values, positionals} = parseArgs({allowPositionals: true, options: {all: {type: 'boolean', default: false}}});
const slugs = values.all || positionals.length === 0 ? listTenantSlugs() : positionals;
if (slugs.length === 0) {
  console.error('Нет ни одной студии в tenants/. Создайте: npm run tenant:new -- <slug>');
  process.exit(1);
}
let failed = 0;
for (const slug of slugs) {
  const r = await checkTenant(slug);
  printReport(r);
  if (!r.ok) failed++;
}
process.exit(failed ? 1 : 0);
