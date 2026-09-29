#!/usr/bin/env tsx
// Generates stylised placeholder artwork (logo, icon, hero, gallery, service
// images) for a tenant folder. Real studios replace these files with their own
// photos; the pipeline only cares about file names referenced in business.json.
// Usage: tsx scripts/tenant/demo-art.ts <slug> --style studio|garage|neutral --accent #RRGGBB --mark "GR"
import sharp from 'sharp';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {tenantDir} from './lib/load.ts';

type Style = 'studio' | 'garage' | 'neutral';

const CAR =
  'M 70 300 C 80 262 128 250 186 244 L 292 200 C 336 184 432 176 522 181 C 596 186 646 212 694 242 L 786 254 C 836 261 866 280 871 306 L 874 330 C 874 346 860 352 846 352 L 802 352 A 54 54 0 0 0 694 352 L 296 352 A 54 54 0 0 0 188 352 L 104 352 C 84 352 70 342 70 326 Z';
const WINDOWS = 'M 300 238 L 350 206 C 380 196 440 192 500 194 L 506 238 Z M 522 238 L 518 195 C 574 199 612 214 650 238 Z';

function wheel(cx: number, cy: number, accent: string) {
  const spokes = Array.from({length: 10}, (_, i) => {
    const a = (i * Math.PI) / 5;
    return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * 30}" y2="${cy + Math.sin(a) * 30}" stroke="#9aa0a8" stroke-width="4"/>`;
  }).join('');
  return `<circle cx="${cx}" cy="${cy}" r="46" fill="#0a0a0b"/><circle cx="${cx}" cy="${cy}" r="33" fill="#2b2e33"/>${spokes}<circle cx="${cx}" cy="${cy}" r="8" fill="${accent}"/>`;
}

function car(accent: string, body: string, x: number, y: number, scale: number, mirror = false) {
  const t = mirror ? `translate(${x} ${y}) scale(${scale} ${-scale})` : `translate(${x} ${y}) scale(${scale})`;
  return `<g transform="${t}">
    <path d="${CAR}" fill="url(#body)"/>
    <path d="${CAR}" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="2.5"/>
    <path d="${WINDOWS}" fill="#0c0f14" opacity="0.92"/>
    <path d="M 120 290 C 300 268 620 262 850 292" stroke="#ffffff" stroke-opacity="0.35" stroke-width="3" fill="none"/>
    <rect x="846" y="282" width="22" height="10" rx="4" fill="${accent}"/>
    <rect x="74" y="286" width="18" height="9" rx="4" fill="#ff3b3b" opacity="0.8"/>
    ${wheel(242, 352, accent)}${wheel(748, 352, accent)}
  </g>
  <defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${body}"/><stop offset="0.55" stop-color="#15171b"/><stop offset="1" stop-color="#050506"/></linearGradient></defs>`;
}

function scene(style: Style, accent: string, w: number, h: number, variant: number) {
  const bgTop = style === 'garage' ? '#1c1511' : style === 'studio' ? '#111418' : '#15161a';
  const bgBottom = style === 'garage' ? '#0b0806' : '#050607';
  const body = style === 'garage' ? '#3a3f47' : variant % 2 ? '#5b6470' : '#2f343b';
  const lights =
    style === 'garage'
      ? Array.from({length: 4}, (_, i) => `<rect x="${w * (0.12 + i * 0.22)}" y="${h * 0.06}" width="${w * 0.14}" height="${h * 0.012}" rx="4" fill="#ffd9b0" opacity="0.85" filter="url(#glow)"/>`).join('')
      : Array.from({length: 6}, (_, i) => `<rect x="${w * 0.1}" y="${h * (0.05 + i * 0.035)}" width="${w * 0.8}" height="${h * 0.008}" rx="3" fill="#e9f4ff" opacity="${0.9 - i * 0.12}" filter="url(#glow)" transform="skewX(-${8 + variant * 3})"/>`).join('');
  const lift =
    style === 'garage'
      ? `<rect x="${w * 0.14}" y="${h * 0.42}" width="${w * 0.02}" height="${h * 0.42}" fill="#e05a10"/><rect x="${w * 0.84}" y="${h * 0.42}" width="${w * 0.02}" height="${h * 0.42}" fill="#e05a10"/><rect x="${w * 0.14}" y="${h * 0.66}" width="${w * 0.72}" height="${h * 0.015}" fill="#39302a"/>`
      : '';
  const carScale = (w * 0.62) / 900;
  const carX = w * 0.19;
  const carY = style === 'garage' ? h * 0.3 : h * 0.34;
  const floorY = carY + 398 * carScale;
  const bokeh = Array.from({length: 14}, (_, i) => {
    const cx = ((i * 137 + variant * 53) % 100) / 100;
    const cy = ((i * 71 + variant * 29) % 40) / 100 + 0.08;
    return `<circle cx="${w * cx}" cy="${h * cy}" r="${h * (0.008 + (i % 4) * 0.004)}" fill="${i % 3 ? accent : '#ffffff'}" opacity="${0.08 + (i % 5) * 0.03}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bgTop}"/><stop offset="1" stop-color="${bgBottom}"/></linearGradient>
    <radialGradient id="spot" cx="0.5" cy="0.55" r="0.6"><stop offset="0" stop-color="${accent}" stop-opacity="0.22"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.2"/><stop offset="1" stop-color="#000" stop-opacity="1"/></linearGradient>
    <filter id="glow" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="${h * 0.006}"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${lights}${bokeh}
  <rect width="${w}" height="${h}" fill="url(#spot)"/>
  ${lift}
  <rect x="0" y="${floorY}" width="${w}" height="${h - floorY}" fill="#08090a"/>
  <g opacity="0.28">${car(accent, body, carX, floorY * 2 - carY, carScale, true)}</g>
  <rect x="0" y="${floorY}" width="${w}" height="${h - floorY}" fill="url(#fade)"/>
  ${car(accent, body, carX, carY, carScale)}
  <ellipse cx="${w / 2}" cy="${floorY + 4}" rx="${w * 0.34}" ry="${h * 0.012}" fill="#000" opacity="0.7"/>
</svg>`;
}

function detail(style: Style, accent: string, w: number, h: number, variant: number) {
  // Abstract close-ups: paint reflections, water beading, wheel, film edge.
  const bg = style === 'garage' ? '#130f0c' : '#0b0d10';
  const layers: string[] = [];
  if (variant % 4 === 0) {
    for (let i = 0; i < 40; i++) {
      const x = ((i * 97) % 100) / 100;
      const y = ((i * 53) % 100) / 100;
      const r = 6 + ((i * 7) % 26);
      layers.push(`<circle cx="${w * x}" cy="${h * y}" r="${r}" fill="url(#drop)"/>`);
    }
  } else if (variant % 4 === 1) {
    for (let i = 0; i < 9; i++) {
      layers.push(`<path d="M ${-w * 0.2} ${h * (0.1 + i * 0.1)} C ${w * 0.3} ${h * (i * 0.1 - 0.1)} ${w * 0.6} ${h * (0.3 + i * 0.1)} ${w * 1.2} ${h * (0.05 + i * 0.1)}" stroke="${i % 3 ? '#cfd8e3' : accent}" stroke-opacity="${0.12 + (i % 3) * 0.1}" stroke-width="${10 + i * 3}" fill="none" filter="url(#soft)"/>`);
    }
  } else if (variant % 4 === 2) {
    const cx = w * 0.55;
    const cy = h * 0.52;
    const R = Math.min(w, h) * 0.38;
    layers.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="#050506"/><circle cx="${cx}" cy="${cy}" r="${R * 0.72}" fill="#23262b"/>`);
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      layers.push(`<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * R * 0.68}" y2="${cy + Math.sin(a) * R * 0.68}" stroke="#aab1ba" stroke-width="${R * 0.05}"/>`);
    }
    layers.push(`<circle cx="${cx}" cy="${cy}" r="${R * 0.16}" fill="${accent}"/><circle cx="${cx - R * 0.7}" cy="${cy - R * 0.2}" r="${R * 0.12}" fill="#c9262b" opacity="0.8"/>`);
  } else {
    layers.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#1b1f25"/>`);
    layers.push(`<path d="M 0 ${h * 0.7} L ${w} ${h * 0.25} L ${w} ${h} L 0 ${h} Z" fill="${accent}" opacity="0.12"/>`);
    layers.push(`<path d="M 0 ${h * 0.7} L ${w} ${h * 0.25}" stroke="${accent}" stroke-width="6" opacity="0.8"/>`);
    for (let i = 0; i < 6; i++) layers.push(`<rect x="${w * 0.1 + i * w * 0.14}" y="${h * 0.15}" width="${w * 0.06}" height="${h * 0.7}" fill="#ffffff" opacity="0.04" transform="skewX(-20)"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="drop" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="0.25" stop-color="#9fb4c8" stop-opacity="0.35"/><stop offset="1" stop-color="#000000" stop-opacity="0.5"/></radialGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#030304"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${layers.join('\n  ')}
</svg>`;
}

function logo(name: string, accent: string) {
  const text = name.toUpperCase();
  const width = 60 + text.length * 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="64" viewBox="0 0 ${width} 64">
  <rect x="4" y="12" width="40" height="40" rx="10" fill="${accent}"/>
  <path d="M 14 38 L 24 22 L 34 38" stroke="#0b0c0e" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="56" y="43" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="2" fill="#f2f4f7">${text}</text>
</svg>`;
}

function icon(mark: string, accent: string, bg: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" rx="220" fill="${bg}"/>
  <circle cx="512" cy="512" r="330" fill="none" stroke="${accent}" stroke-width="44"/>
  <text x="512" y="600" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="260" font-weight="900" fill="#f4f5f7">${mark}</text>
</svg>`;
}

async function main() {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {style: {type: 'string', default: 'neutral'}, accent: {type: 'string', default: '#7CC4FF'}, mark: {type: 'string', default: 'AS'}, name: {type: 'string', default: 'Studio'}, bg: {type: 'string', default: '#0B0C0E'}},
  });
  const slug = positionals[0];
  if (!slug) throw new Error('usage: demo-art.ts <slug> [--style] [--accent] [--mark] [--name]');
  const style = values.style as Style;
  const accent = values.accent!;
  const out = join(tenantDir(slug), 'images');
  mkdirSync(out, {recursive: true});
  const jpg = (svg: string, file: string) => sharp(Buffer.from(svg)).jpeg({quality: 84, mozjpeg: true}).toFile(join(out, file));
  await sharp(Buffer.from(logo(values.name!, accent))).toFile(join(out, 'logo.png')).catch(() => null);
  const {writeFileSync} = await import('node:fs');
  writeFileSync(join(out, 'logo.svg'), logo(values.name!, accent));
  await sharp(Buffer.from(icon(values.mark!, accent, values.bg!))).png().toFile(join(out, 'icon.png'));
  await jpg(scene(style, accent, 1800, 1200, 0), 'hero.jpg');
  for (let i = 1; i <= 4; i++) await jpg(scene(style, accent, 1600, 1100, i), `gallery-${i}.jpg`);
  for (let i = 0; i < 4; i++) await jpg(detail(style, accent, 1200, 900, i), `detail-${i + 1}.jpg`);
  console.log(`artwork written to ${out}`);
}

await main();
