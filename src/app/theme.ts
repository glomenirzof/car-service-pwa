// Runtime Astryx theme per studio: the neutral theme with ONE accent taken
// from business.json. The theme is defined through the documented
// defineTheme() + <Theme> provider; no --color-* overrides in :root.
import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';

const FONT_FALLBACKS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const cache = new Map<string, ReturnType<typeof defineTheme>>();

export function tenantTheme(slug: string, accent: string, background: string) {
  const key = `${slug}:${accent}:${background}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const theme = defineTheme({
    name: `tenant-${slug}`,
    extends: neutralTheme,
    color: {accent: [accent, accent], neutralStyle: 'cool'},
    typography: {
      scale: {base: 15, ratio: 1.2},
      body: {family: 'Inter Variable', fallbacks: FONT_FALLBACKS},
      heading: {family: 'Inter Variable', fallbacks: FONT_FALLBACKS},
    },
    radius: {base: 6, multiplier: 1.4},
    tokens: {
      '--color-background-body': [background, background],
    },
  });
  cache.set(key, theme);
  return theme;
}
