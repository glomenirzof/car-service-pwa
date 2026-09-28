// Generates every static asset of one tenant: icons (any + maskable),
// apple-touch-icon, favicon, iOS startup images, responsive WebP media,
// manifests. Output: <outDir>/t/<slug>/...
import sharp from 'sharp';
import {mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync} from 'node:fs';
import {join, extname} from 'node:path';
import type {BusinessConfig} from '../../../supabase/functions/_shared/tenant-config.ts';
import {STARTUP_DEVICES, startupFile, MEDIA_WIDTHS} from './devices.ts';
import {mediaImages, tenantDir} from './load.ts';
import {renderManifest} from './shell.ts';
import type {ImageMeta} from './payload.ts';

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return {r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1};
}

async function iconSquare(src: string, size: number, background: string, paddingRatio: number) {
  const inner = Math.round(size * (1 - paddingRatio * 2));
  const icon = await sharp(src).resize(inner, inner, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer();
  return sharp({create: {width: size, height: size, channels: 4, background: hexToRgb(background)}})
    .composite([{input: icon, gravity: 'center'}])
    .png({compressionLevel: 9})
    .toBuffer();
}

export async function imageMeta(cfg: BusinessConfig): Promise<ImageMeta> {
  const meta: ImageMeta = {};
  for (const file of mediaImages(cfg)) {
    const m = await sharp(join(tenantDir(cfg.slug), file)).metadata();
    meta[file] = {width: m.width ?? 0, height: m.height ?? 0};
  }
  return meta;
}

export async function generateTenantAssets(cfg: BusinessConfig, outDir: string, version: string) {
  const src = tenantDir(cfg.slug);
  const base = join(outDir, 't', cfg.slug);
  for (const d of ['icons', 'splash', 'media']) mkdirSync(join(base, d), {recursive: true});
  const bg = cfg.brand.background;
  const iconSrc = join(src, cfg.brand.icon);
  const maskSrc = cfg.brand.maskableIcon ? join(src, cfg.brand.maskableIcon) : iconSrc;
  const written: string[] = [];
  const write = (rel: string, data: Buffer | string) => {
    writeFileSync(join(base, rel), data);
    written.push(`/t/${cfg.slug}/${rel}`);
  };

  // Icons: "any" keeps transparency; maskable keeps the logo inside the 80% safe zone;
  // apple-touch-icon must be opaque (iOS fills transparency with black).
  for (const size of [192, 512]) {
    write(`icons/icon-${size}.png`, await sharp(iconSrc).resize(size, size, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer());
    write(`icons/maskable-${size}.png`, await iconSquare(maskSrc, size, bg, cfg.brand.maskableIcon ? 0 : 0.14));
  }
  write('icons/apple-touch-icon.png', await iconSquare(iconSrc, 180, bg, 0.08));
  write('icons/favicon-32.png', await sharp(iconSrc).resize(32, 32, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer());

  const logoPath = join(src, cfg.brand.logo);
  if (extname(logoPath) === '.svg') {
    copyFileSync(logoPath, join(base, 'logo.svg'));
    written.push(`/t/${cfg.slug}/logo.svg`);
  } else {
    // Wrap raster logos into an SVG so the same URL works everywhere.
    const png = await sharp(logoPath).resize(256, 256, {fit: 'inside'}).png().toBuffer();
    const m = await sharp(png).metadata();
    write('logo.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}"><image href="data:image/png;base64,${png.toString('base64')}" width="${m.width}" height="${m.height}"/></svg>`);
  }

  // iOS startup images: brand background with the icon centered.
  for (const d of STARTUP_DEVICES) {
    const w = d.w * d.dpr;
    const h = d.h * d.dpr;
    const iconSize = Math.round(Math.min(w, h) * 0.28);
    const icon = await sharp(iconSrc).resize(iconSize, iconSize, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer();
    write(
      `splash/${startupFile(d)}`,
      await sharp({create: {width: w, height: h, channels: 3, background: hexToRgb(bg)}})
        .composite([{input: icon, gravity: 'center'}])
        .png({compressionLevel: 9, palette: true})
        .toBuffer(),
    );
  }

  // Responsive WebP media.
  for (const file of mediaImages(cfg)) {
    const stem = file.replace(/^images\//, '').replace(/\.[a-z]+$/i, '');
    for (const width of MEDIA_WIDTHS) {
      write(`media/${stem}-${width}.webp`, await sharp(join(src, file)).resize({width, withoutEnlargement: true}).webp({quality: 78}).toBuffer());
    }
  }

  write('manifest.webmanifest', JSON.stringify(renderManifest(cfg, 'client', version), null, 2));
  write('owner.webmanifest', JSON.stringify(renderManifest(cfg, 'owner', version), null, 2));
  return written;
}

export function readTemplate(outDir: string, kind: 'client' | 'owner') {
  const file = join(outDir, 'shell', `${kind}.html`);
  if (!existsSync(file)) throw new Error(`built shell template not found: ${file} (run vite build first)`);
  return readFileSync(file, 'utf8');
}
