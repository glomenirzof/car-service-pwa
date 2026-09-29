#!/usr/bin/env tsx
// npm run tenant:new -- <slug> [--name "Название"] [--from <existing-slug>] [--accent #RRGGBB] [--timezone Europe/Moscow]
// Creates tenants/<slug>/ from the template (or another studio) and validates it.
import {parseArgs} from 'node:util';
import {cpSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {TENANTS_DIR, tenantDir} from './lib/load.ts';
import {checkTenant, printReport} from './lib/checks.ts';

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    name: {type: 'string'},
    from: {type: 'string', default: '_template'},
    accent: {type: 'string'},
    timezone: {type: 'string'},
    force: {type: 'boolean', default: false},
  },
});
const slug = positionals[0];
if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(slug)) {
  console.error('Укажите slug: латиница, цифры, дефис (2–40 символов). Пример: npm run tenant:new -- my-studio --name "Моя студия"');
  process.exit(2);
}
const target = tenantDir(slug);
if (existsSync(target) && !values.force) {
  console.error(`tenants/${slug} уже существует — существующие студии не перезаписываются (используйте --force осознанно).`);
  process.exit(1);
}
const source = join(TENANTS_DIR, values.from!);
if (!existsSync(join(source, 'business.json'))) {
  console.error(`Шаблон tenants/${values.from} не найден`);
  process.exit(1);
}
cpSync(source, target, {recursive: true});
const file = join(target, 'business.json');
const cfg = JSON.parse(readFileSync(file, 'utf8'));
cfg.slug = slug;
if (values.name) {
  cfg.name = values.name;
  cfg.shortName = (values.name.split(/\s+/)[0] ?? values.name).slice(0, 12);
}
if (values.accent) cfg.brand.accent = values.accent;
if (values.timezone) cfg.timezone = values.timezone;
writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log(`Создано tenants/${slug}/ из ${values.from}. Замените изображения в tenants/${slug}/images и заполните business.json.`);
const report = await checkTenant(slug);
printReport(report);
console.log(`Дальше: npm run tenant:validate -- ${slug} && npm run tenant:publish -- ${slug}`);
