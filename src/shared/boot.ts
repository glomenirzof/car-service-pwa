// Tenant boot config rendered into the HTML shell by the tenant pipeline.
// Static per studio (name, accent, paths); runtime data comes from the API.
// Validated by hand: pulling a schema library into every page load for nine
// fields is not worth its weight on mobile.
export type Boot = {
  app: 'client' | 'owner';
  slug: string;
  name: string;
  shortName: string;
  accent: string;
  background: string;
  basePath: string;
  assetBase: string;
  assistantName: string;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function parseBoot(raw: unknown): Boot {
  const v = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string, test?: (s: string) => boolean): string => {
    const s = v[k];
    if (typeof s !== 'string' || (test && !test(s))) throw new Error(`tenant boot config: invalid "${k}"`);
    return s;
  };
  const app = str('app', (s) => s === 'client' || s === 'owner') as Boot['app'];
  return {
    app,
    slug: str('slug', (s) => /^[a-z0-9-]+$/.test(s)),
    name: str('name'),
    shortName: str('shortName'),
    accent: str('accent', (s) => HEX.test(s)),
    background: str('background', (s) => HEX.test(s)),
    basePath: str('basePath', (s) => s.startsWith('/s/')),
    assetBase: str('assetBase', (s) => s.startsWith('/t/')),
    assistantName: str('assistantName'),
  };
}

let cached: Boot | null = null;

export function readBoot(doc: Document = document): Boot {
  if (cached && doc === document) return cached;
  const el = doc.getElementById('tenant-boot');
  if (!el?.textContent) throw new Error('tenant boot config is missing from the page');
  const boot = parseBoot(JSON.parse(el.textContent));
  if (doc === document) cached = boot;
  return boot;
}

export function setBootForTests(boot: Boot) {
  cached = boot;
}
