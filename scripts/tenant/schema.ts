#!/usr/bin/env tsx
// Writes schemas/business.schema.json (editor autocomplete for business.json) from the Zod contract.
import {writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {businessConfigSchema} from '../../supabase/functions/_shared/core/tenant-config.ts';
import {ROOT} from './lib/load.ts';
import {isMain} from '../lib/is-main.ts';

export function businessJsonSchema() {
  return z.toJSONSchema(businessConfigSchema, {io: 'input', unrepresentable: 'any'});
}

if (isMain(import.meta.url)) {
  mkdirSync(join(ROOT, 'schemas'), {recursive: true});
  writeFileSync(join(ROOT, 'schemas', 'business.schema.json'), JSON.stringify(businessJsonSchema(), null, 2) + '\n');
  console.log('schemas/business.schema.json updated');
}
