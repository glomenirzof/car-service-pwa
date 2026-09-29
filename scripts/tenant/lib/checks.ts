// Deep validation beyond the Zod schema: image files, sizes, accent contrast.
import sharp from 'sharp';
import {join} from 'node:path';
import {listTenantSlugs, loadTenant, tenantDir, mediaImages} from './load.ts';
import type {BusinessConfig} from '../../../supabase/functions/_shared/core/tenant-config.ts';

export type Report = {slug: string; ok: boolean; errors: string[]; warnings: string[]; config?: BusinessConfig};

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrastRatio(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

export async function checkTenant(slug: string): Promise<Report> {
  const loaded = loadTenant(slug);
  if (!loaded.ok) return {slug, ok: false, errors: loaded.errors, warnings: []};
  const cfg = loaded.config;
  const errors: string[] = [];
  const warnings: string[] = [];
  const dir = tenantDir(slug);

  const icon = await sharp(join(dir, cfg.brand.icon)).metadata();
  if ((icon.width ?? 0) < 512 || icon.width !== icon.height) {
    errors.push(`${cfg.brand.icon}: нужна квадратная иконка не меньше 512×512 (сейчас ${icon.width}×${icon.height})`);
  }
  if (cfg.brand.maskableIcon) {
    const m = await sharp(join(dir, cfg.brand.maskableIcon)).metadata();
    if ((m.width ?? 0) < 512 || m.width !== m.height) errors.push(`${cfg.brand.maskableIcon}: maskable-иконка должна быть квадратной ≥512`);
  }
  for (const file of mediaImages(cfg)) {
    const m = await sharp(join(dir, file)).metadata();
    const minWidth = file === cfg.brand.hero ? 1200 : 800;
    if ((m.width ?? 0) < minWidth) errors.push(`${file}: ширина ${m.width}px, нужно не меньше ${minWidth}px`);
  }
  const ratio = contrastRatio(cfg.brand.accent, cfg.brand.background);
  if (ratio < 3) errors.push(`акцент ${cfg.brand.accent} плохо виден на фоне ${cfg.brand.background} (контраст ${ratio.toFixed(2)}:1, нужно ≥3:1)`);
  if (luminance(cfg.brand.background) > 0.08) warnings.push(`фон ${cfg.brand.background} светлый: приложение рассчитано на тёмную тему`);

  const reachable = new Set(cfg.resources.flatMap((r) => r.capabilities));
  const unused = [...reachable].filter((c) => !cfg.services.some((s) => s.capability === c));
  if (unused.length) warnings.push(`ресурсы умеют ${unused.join(', ')}, но таких услуг нет`);
  if (cfg.services.every((s) => !s.popular)) warnings.push('ни одна услуга не отмечена popular — главный экран покажет первые по списку');

  // A studio cloned with --from keeps the source's texts until someone edits them.
  for (const other of listTenantSlugs()) {
    if (other === slug) continue;
    const o = loadTenant(other);
    if (!o.ok) continue;
    const same = [
      o.config.name === cfg.name && 'название',
      o.config.contacts.phone === cfg.contacts.phone && 'телефон',
      o.config.contacts.address === cfg.contacts.address && 'адрес',
      o.config.description === cfg.description && 'описание',
    ].filter(Boolean);
    if (same.length) warnings.push(`совпадает со студией ${other}: ${same.join(', ')} — замените данные клона`);
  }

  return {slug, ok: errors.length === 0, errors, warnings, config: cfg};
}

export function printReport(r: Report) {
  const head = r.ok ? `✔ ${r.slug}` : `✖ ${r.slug}`;
  console.log(head);
  for (const e of r.errors) console.log(`   ошибка: ${e}`);
  for (const w of r.warnings) console.log(`   внимание: ${w}`);
}
