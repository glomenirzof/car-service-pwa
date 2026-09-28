// Renders the per-tenant HTML shell from the shared Vite-built template.
// One JS/CSS build serves every studio; only this HTML differs: title,
// metadata, manifest, icons, startup images and the boot JSON.
import type {BusinessConfig} from '../../../supabase/functions/_shared/tenant-config.ts';
import {STARTUP_DEVICES, startupFile, startupMedia} from './devices.ts';

export type ShellKind = 'client' | 'owner';

export type BootConfig = {
  app: ShellKind;
  slug: string;
  name: string;
  shortName: string;
  accent: string;
  background: string;
  basePath: string;
  assetBase: string;
  assistantName: string;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// JSON inside <script type="application/json"> must not be able to close the tag.
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');

export function bootConfig(cfg: BusinessConfig, kind: ShellKind): BootConfig {
  return {
    app: kind,
    slug: cfg.slug,
    name: cfg.name,
    shortName: cfg.shortName,
    accent: cfg.brand.accent,
    background: cfg.brand.background,
    basePath: kind === 'owner' ? `/s/${cfg.slug}/owner` : `/s/${cfg.slug}`,
    assetBase: `/t/${cfg.slug}`,
    assistantName: cfg.ai.assistantName,
  };
}

export function renderShell(template: string, cfg: BusinessConfig, kind: ShellKind, version = ''): string {
  const t = `/t/${cfg.slug}`;
  const v = version ? `?v=${version.slice(0, 12)}` : '';
  const title = kind === 'owner' ? `${cfg.name} — кабинет` : cfg.name;
  const appTitle = kind === 'owner' ? `${cfg.shortName} ·  кабинет` : cfg.shortName;
  const manifest = kind === 'owner' ? `${t}/owner.webmanifest${v}` : `${t}/manifest.webmanifest${v}`;
  const description = kind === 'owner' ? `Кабинет владельца ${cfg.name}` : `${cfg.tagline}. Онлайн-запись.`;
  const head = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="theme-color" content="${cfg.brand.background}" />`,
    `<meta name="color-scheme" content="dark" />`,
    kind === 'owner' ? `<meta name="robots" content="noindex, nofollow" />` : '',
    `<link rel="manifest" href="${manifest}" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${t}/icons/favicon-32.png${v}" />`,
    `<link rel="icon" type="image/svg+xml" href="${t}/logo.svg${v}" />`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${t}/icons/apple-touch-icon.png${v}" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtml(appTitle)}" />`,
    ...STARTUP_DEVICES.map(
      (d) => `<link rel="apple-touch-startup-image" media="${startupMedia(d)}" href="${t}/splash/${startupFile(d)}${v}" />`,
    ),
    `<meta property="og:title" content="${escapeHtml(cfg.name)}" />`,
    `<meta property="og:description" content="${escapeHtml(cfg.tagline)}" />`,
    `<meta property="og:image" content="${t}/media/${cfg.brand.hero.replace(/^images\//, '').replace(/\.[a-z]+$/i, '')}-1600.webp" />`,
    `<style>html,body{background:${cfg.brand.background};color-scheme:dark}</style>`,
  ]
    .filter(Boolean)
    .join('\n    ');
  const boot = `<script id="tenant-boot" type="application/json">${safeJson(bootConfig(cfg, kind))}</script>`;
  if (!template.includes('<!--tenant-head-->') || !template.includes('<!--tenant-boot-->')) {
    throw new Error('shell template is missing <!--tenant-head--> or <!--tenant-boot--> placeholder');
  }
  return template.replace('<!--tenant-head-->', head).replace('<!--tenant-boot-->', boot);
}

export function renderManifest(cfg: BusinessConfig, kind: ShellKind, version = '') {
  const base = kind === 'owner' ? `/s/${cfg.slug}/owner/` : `/s/${cfg.slug}/`;
  const t = `/t/${cfg.slug}`;
  const v = version ? `?v=${version.slice(0, 12)}` : '';
  return {
    id: base,
    name: kind === 'owner' ? `${cfg.name} — кабинет` : cfg.name,
    short_name: kind === 'owner' ? `${cfg.shortName} кабинет`.slice(0, 24) : cfg.shortName,
    description: kind === 'owner' ? `Кабинет владельца ${cfg.name}` : cfg.tagline,
    lang: 'ru',
    dir: 'ltr',
    start_url: `${base}?source=pwa`,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    background_color: cfg.brand.background,
    theme_color: cfg.brand.background,
    categories: ['auto', 'lifestyle', 'business'],
    icons: [
      {src: `${t}/icons/icon-192.png${v}`, sizes: '192x192', type: 'image/png', purpose: 'any'},
      {src: `${t}/icons/icon-512.png${v}`, sizes: '512x512', type: 'image/png', purpose: 'any'},
      {src: `${t}/icons/maskable-192.png${v}`, sizes: '192x192', type: 'image/png', purpose: 'maskable'},
      {src: `${t}/icons/maskable-512.png${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable'},
    ],
    shortcuts:
      kind === 'owner'
        ? [{name: 'Расписание', url: `${base}`}, {name: 'Статистика', url: `${base}stats`}]
        : [{name: 'Записаться', url: `${base}services`}, {name: 'Мои записи', url: `${base}bookings`}],
  };
}
