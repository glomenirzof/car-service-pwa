import {businessConfigSchema, formatConfigIssues} from '../../../supabase/functions/_shared/core/tenant-config.ts';
import {fixtureConfig} from '../../../tests/fixtures/business.ts';
import {renderShell, renderManifest, bootConfig} from './shell.ts';
import {buildPublishPayload, configHash} from './payload.ts';

describe('business.json schema', () => {
  it('accepts the fixture and applies defaults', () => {
    const cfg = fixtureConfig();
    expect(cfg.brand.background).toBe('#0B0C0E');
    expect(cfg.ai.enabled).toBe(true);
    expect(cfg.services[1]!.completion).toBe('multi_day');
  });

  it('rejects unknown timezone, missing capability, overlapping hours, same_day longer than any window', () => {
    const raw = structuredClone(fixtureConfig()) as Record<string, unknown> & {services: {capability: string; durationMinutes: number; completion: string}[]; workingHours: Record<string, string[][]>};
    raw.timezone = 'Mars/Olympus';
    raw.services[0]!.capability = 'teleport';
    raw.workingHours.mon = [['09:00', '14:00'], ['13:00', '18:00']];
    raw.services[1]!.completion = 'same_day';
    const r = businessConfigSchema.safeParse(raw);
    expect(r.success).toBe(false);
    const issues = formatConfigIssues(r.error!).join('\n');
    expect(issues).toContain('timezone');
    expect(issues).toContain('teleport');
    expect(issues).toContain('пересекаются');
    expect(issues).toContain('multi_day');
  });

  it('rejects duplicate keys and bad slug', () => {
    const raw = structuredClone(fixtureConfig()) as Record<string, unknown> & {resources: {key: string}[]};
    raw.slug = 'Bad Slug';
    raw.resources[1]!.key = raw.resources[0]!.key;
    const r = businessConfigSchema.safeParse(raw);
    expect(r.success).toBe(false);
    const issues = formatConfigIssues(r.error!).join('\n');
    expect(issues).toContain('slug');
    expect(issues).toContain('повторяющийся key');
  });
});

describe('tenant shell', () => {
  const template = '<html><head><!--tenant-head--></head><body><div id="root"></div><!--tenant-boot--></body></html>';

  it('renders per-tenant metadata, manifest link, icons and a safe boot JSON', () => {
    const cfg = fixtureConfig({name: 'Evil </script><script>alert(1)</script>'});
    const html = renderShell(template, cfg, 'client', 'abc123');
    expect(html).toContain('<link rel="manifest" href="/t/alpha/manifest.webmanifest?v=abc123" />');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('apple-touch-startup-image');
    expect(html).not.toContain('</script><script>alert(1)');
    const boot = JSON.parse(html.match(/<script id="tenant-boot" type="application\/json">(.*?)<\/script>/)![1]!);
    expect(boot).toMatchObject({app: 'client', slug: 'alpha', basePath: '/s/alpha'});
  });

  it('owner shell has its own manifest and is not indexed', () => {
    const html = renderShell(template, fixtureConfig(), 'owner');
    expect(html).toContain('/t/alpha/owner.webmanifest');
    expect(html).toContain('noindex');
    expect(bootConfig(fixtureConfig(), 'owner').basePath).toBe('/s/alpha/owner');
  });

  it('manifests have tenant id, start_url and scope plus any + maskable icons', () => {
    const m = renderManifest(fixtureConfig(), 'client');
    expect(m).toMatchObject({id: '/s/alpha/', scope: '/s/alpha/', start_url: '/s/alpha/?source=pwa', display: 'standalone'});
    expect(m.icons.map((i) => i.purpose)).toEqual(['any', 'any', 'maskable', 'maskable']);
    const o = renderManifest(fixtureConfig(), 'owner');
    expect(o).toMatchObject({id: '/s/alpha/owner/', scope: '/s/alpha/owner/'});
  });
});

describe('publish payload', () => {
  it('maps config to DB payload with static media paths and weekday numbers', () => {
    const p = buildPublishPayload(fixtureConfig({exceptions: [{date: '2030-01-01', hours: [], note: 'NY'}]}));
    expect(p.workingHours).toHaveLength(7);
    expect(p.workingHours[0]).toEqual({weekday: 1, opens: '09:00', closes: '21:00'});
    expect(p.exceptions).toEqual([{date: '2030-01-01', opens: null, closes: null, note: 'NY'}]);
    expect(p.media[0]).toMatchObject({kind: 'hero', path: '/t/alpha/media/hero'});
    expect(p.services[0]).toMatchObject({key: 'wash', priceAmount: 2000, durationMinutes: 60, bufferMinutes: 15});
  });

  it('config hash is stable regardless of key order', () => {
    expect(configHash({a: 1, b: {c: 2, d: 3}})).toBe(configHash({b: {d: 3, c: 2}, a: 1}));
    expect(configHash({a: 1})).not.toBe(configHash({a: 2}));
  });
});
