import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ROOT} from './env.ts';

export type TenantInfo = {
  slug: string;
  name: string;
  shortName: string;
  accent: string;
  resources: {key: string; capabilities: string[]}[];
  services: {key: string; name: string; capability: string; completion?: string}[];
};

/** Studio data comes from the pipeline input, never hard-coded in tests. */
export function tenant(slug: string): TenantInfo {
  const cfg = JSON.parse(readFileSync(resolve(ROOT, 'tenants', slug, 'business.json'), 'utf8'));
  return {slug, name: cfg.name, shortName: cfg.shortName, accent: cfg.brand.accent, resources: cfg.resources, services: cfg.services};
}

export const STUDIOS = ['graphite', 'rotorlab'] as const;
