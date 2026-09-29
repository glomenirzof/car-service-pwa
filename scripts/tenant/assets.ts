#!/usr/bin/env tsx
// Generates static assets for local development into .generated/site/t/<slug>/.
// (The production build renders them into dist/ via render-site.ts.)
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {listTenantSlugs, loadTenantOrThrow, ROOT} from './lib/load.ts';
import {generateTenantAssets} from './lib/assets.ts';
import {configHash} from './lib/payload.ts';

const {values, positionals} = parseArgs({allowPositionals: true, options: {out: {type: 'string', default: '.generated/site'}}});
const slugs = positionals.length ? positionals : listTenantSlugs();
const out = resolve(ROOT, values.out!);
for (const slug of slugs) {
  const cfg = loadTenantOrThrow(slug);
  const files = await generateTenantAssets(cfg, out, configHash(cfg));
  console.log(`${slug}: ${files.length} файлов → ${out}/t/${slug}`);
}
