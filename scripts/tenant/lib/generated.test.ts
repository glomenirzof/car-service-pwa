// Generated files must be in sync with their sources.
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {generateSeed} from '../seed-generate.ts';
import {businessJsonSchema} from '../schema.ts';
import {listTenantSlugs, loadTenant} from './load.ts';

const ROOT = resolve(import.meta.dirname, '../../..');

it('supabase/seed.sql is generated from the current tenants (npm run seed:generate)', async () => {
  expect(readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8')).toBe(await generateSeed());
});

it('schemas/business.schema.json is up to date (tsx scripts/tenant/schema.ts)', () => {
  expect(JSON.parse(readFileSync(join(ROOT, 'schemas/business.schema.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(businessJsonSchema())));
});

it('ships exactly two clearly different demo studios', () => {
  const slugs = listTenantSlugs();
  expect(slugs).toEqual(['graphite', 'rotorlab']);
  const [a, b] = slugs.map((s) => loadTenant(s)).map((r) => (r.ok ? r.config : null));
  expect(a && b).toBeTruthy();
  expect(a!.timezone).not.toBe(b!.timezone);
  expect(a!.brand.accent).not.toBe(b!.brand.accent);
  expect(new Set(a!.services.map((s) => s.key)).isDisjointFrom(new Set(b!.services.map((s) => s.key)))).toBe(true);
});

it('no business name from tenants/ appears in src/', async () => {
  const {spawnSync} = await import('node:child_process');
  for (const slug of listTenantSlugs()) {
    const r = loadTenant(slug);
    if (!r.ok) continue;
    for (const needle of [r.config.name, r.config.shortName, r.config.contacts.phone]) {
      const res = spawnSync('grep', ['-rIl', '--', needle, join(ROOT, 'src')], {encoding: 'utf8'});
      expect(res.status, `grep failed: ${res.stderr}`).not.toBe(2);
      expect(res.stdout.trim(), `${needle} found in src/`).toBe('');
    }
  }
});
