import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {businessConfigSchema, formatConfigIssues, type BusinessConfig} from '../../../supabase/functions/_shared/tenant-config.ts';

export const ROOT = resolve(import.meta.dirname, '../../..');
export const TENANTS_DIR = resolve(ROOT, 'tenants');

export function tenantDir(slug: string) {
  return join(TENANTS_DIR, slug);
}

export function listTenantSlugs(): string[] {
  if (!existsSync(TENANTS_DIR)) return [];
  return readdirSync(TENANTS_DIR)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .filter((name) => existsSync(join(TENANTS_DIR, name, 'business.json')))
    .sort();
}

export type LoadResult =
  | {ok: true; slug: string; config: BusinessConfig; raw: unknown}
  | {ok: false; slug: string; errors: string[]};

export function loadTenant(slug: string): LoadResult {
  const file = join(tenantDir(slug), 'business.json');
  if (!existsSync(file)) return {ok: false, slug, errors: [`нет файла ${file}`]};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {ok: false, slug, errors: [`business.json не является корректным JSON: ${(error as Error).message}`]};
  }
  const parsed = businessConfigSchema.safeParse(raw);
  if (!parsed.success) return {ok: false, slug, errors: formatConfigIssues(parsed.error)};
  const errors: string[] = [];
  if (parsed.data.slug !== slug) errors.push(`slug "${parsed.data.slug}" не совпадает с именем папки "${slug}"`);
  for (const file of referencedImages(parsed.data)) {
    const path = join(tenantDir(slug), file);
    if (!existsSync(path) || !statSync(path).isFile()) errors.push(`изображение не найдено: ${file}`);
  }
  if (errors.length) return {ok: false, slug, errors};
  return {ok: true, slug, config: parsed.data, raw};
}

export function loadTenantOrThrow(slug: string): BusinessConfig {
  const r = loadTenant(slug);
  if (!r.ok) throw new Error(`tenants/${slug}: \n  - ${r.errors.join('\n  - ')}`);
  return r.config;
}

export function referencedImages(cfg: BusinessConfig): string[] {
  const files = new Set<string>([cfg.brand.logo, cfg.brand.icon, cfg.brand.hero]);
  if (cfg.brand.maskableIcon) files.add(cfg.brand.maskableIcon);
  cfg.gallery.forEach((g) => files.add(g.file));
  cfg.services.forEach((s) => s.image && files.add(s.image));
  return [...files];
}

export function mediaImages(cfg: BusinessConfig): string[] {
  const files = new Set<string>([cfg.brand.hero]);
  cfg.gallery.forEach((g) => files.add(g.file));
  cfg.services.forEach((s) => s.image && files.add(s.image));
  return [...files];
}
