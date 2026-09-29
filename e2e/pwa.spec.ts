// Stage 7: one shared build, many installable studios on one origin.
// Checked against the production build served with the deployed routing rules.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, test, type Page} from '@playwright/test';
import {DIST_DIR, FUNCTIONS_URL} from './support/env.ts';
import {STUDIOS, tenant} from './support/tenants.ts';

function bootOf(html: string) {
  const m = html.match(/<script id="tenant-boot" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error('no boot json');
  return JSON.parse(m[1]!) as {app: string; slug: string; name: string; accent: string; basePath: string};
}

async function controlledBy(page: Page, slug: string) {
  await page.waitForFunction(
    (s) => navigator.serviceWorker.controller !== null && navigator.serviceWorker.controller.scriptURL.endsWith('/sw.js') && location.pathname.startsWith(`/s/${s}/`),
    slug,
    {timeout: 20_000},
  );
}

for (const slug of STUDIOS) {
  const t = tenant(slug);

  test(`${slug}: deep links return this studio's client and owner shells`, async ({request}) => {
    for (const path of [`/s/${slug}/`, `/s/${slug}/services`, `/s/${slug}/bookings/0f5b0f5b-aaaa-4bbb-8ccc-000000000000`, `/s/${slug}/b`]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const html = await res.text();
      expect(html).toContain(`<title>${t.name}</title>`);
      expect(bootOf(html)).toMatchObject({app: 'client', slug, accent: t.accent, basePath: `/s/${slug}`});
      expect(html).toContain(`href="/t/${slug}/manifest.webmanifest`);
    }
    for (const path of [`/s/${slug}/owner/`, `/s/${slug}/owner/stats`, `/s/${slug}/owner/bookings/x`]) {
      const html = await (await request.get(path)).text();
      expect(bootOf(html), path).toMatchObject({app: 'owner', slug, basePath: `/s/${slug}/owner`});
      expect(html).toContain(`href="/t/${slug}/owner.webmanifest`);
      expect(html).toContain('noindex');
    }
  });

  test(`${slug}: HTML metadata, icons and startup images`, async ({request}) => {
    const html = await (await request.get(`/s/${slug}/`)).text();
    const hrefs = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1]!);
    const apple = hrefs(/rel="apple-touch-icon"[^>]*href="([^"]+)"/g);
    const startup = hrefs(/rel="apple-touch-startup-image"[^>]*href="([^"]+)"/g);
    const icons = hrefs(/rel="icon"[^>]*href="([^"]+)"/g);
    expect(apple).toHaveLength(1);
    expect(startup.length).toBeGreaterThanOrEqual(10);
    expect(html).toMatch(/name="apple-mobile-web-app-title" content="[^"]+"/);
    expect(html).toContain('name="theme-color"');
    for (const href of [...apple, ...icons, ...startup.slice(0, 3)]) {
      expect(href.startsWith(`/t/${slug}/`), href).toBe(true);
      const res = await request.get(href);
      expect(res.status(), href).toBe(200);
      expect(res.headers()['content-type']).toMatch(/image\//);
    }
  });

  test(`${slug}: manifests have own id, start_url, scope and maskable icons`, async ({request}) => {
    for (const kind of ['client', 'owner'] as const) {
      const base = kind === 'owner' ? `/s/${slug}/owner/` : `/s/${slug}/`;
      const res = await request.get(`/t/${slug}/${kind === 'owner' ? 'owner' : 'manifest'}.webmanifest`);
      expect(res.status()).toBe(200);
      const m = await res.json();
      expect(m).toMatchObject({id: base, scope: base, display: 'standalone'});
      expect(m.start_url.startsWith(base)).toBe(true);
      expect(m.name).toContain(t.name);
      const purposes = new Set(m.icons.map((i: {purpose: string}) => i.purpose));
      expect(purposes).toEqual(new Set(['any', 'maskable']));
      expect(m.icons.some((i: {sizes: string}) => i.sizes === '512x512')).toBe(true);
      for (const icon of m.icons) {
        const r = await request.get(icon.src);
        expect(r.status(), icon.src).toBe(200);
        expect(r.headers()['content-type']).toBe('image/png');
      }
    }
  });
}

test('manifests of different studios never share identity', async ({request}) => {
  const ids = new Set<string>();
  for (const slug of STUDIOS) {
    for (const file of ['manifest', 'owner']) {
      const m = await (await request.get(`/t/${slug}/${file}.webmanifest`)).json();
      ids.add(m.id);
    }
  }
  expect(ids.size).toBe(STUDIOS.length * 2);
});

test('deployment headers: worker scope, CSP allows the function origin', async ({request}) => {
  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(sw.headers()['service-worker-allowed']).toBe('/s/');
  expect(sw.headers()['cache-control']).toBe('no-cache');
  const csp = (await request.get('/s/graphite/')).headers()['content-security-policy']!;
  expect(csp).toContain(`connect-src 'self' ${new URL(FUNCTIONS_URL).origin}`);
  expect(csp).toContain("frame-ancestors 'none'");
});

test('each studio registers its own worker scope and cache names; API responses are never cached', async ({page}) => {
  for (const slug of STUDIOS) {
    await page.goto(`/s/${slug}/`);
    await expect(page.getByRole('heading', {level: 1}).first()).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await controlledBy(page, slug);
  }
  const {scopes, caches: cacheMap} = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((r) => r.url);
    }
    return {scopes: regs.map((r) => new URL(r.scope).pathname).sort(), caches: out};
  });
  expect(scopes).toEqual(STUDIOS.map((s) => `/s/${s}/`).sort());

  const names = Object.keys(cacheMap);
  for (const slug of STUDIOS) {
    const own = names.filter((n) => n.startsWith(`svc-${slug}-`));
    expect(own.some((n) => n.includes('precache')), `${slug} precache`).toBe(true);
    expect(own).toContain(`svc-${slug}-shell-v1`);
  }
  expect(names.every((n) => STUDIOS.some((s) => n.startsWith(`svc-${s}-`)))).toBe(true);
  for (const [name, urls] of Object.entries(cacheMap)) {
    const slug = STUDIOS.find((s) => name.startsWith(`svc-${s}-`))!;
    const other = STUDIOS.find((s) => s !== slug)!;
    for (const url of urls) {
      expect(url, name).not.toContain('/functions/v1');
      expect(new URL(url).pathname.startsWith(`/s/${other}/`) || new URL(url).pathname.startsWith(`/t/${other}/`), `${name}: ${url}`).toBe(false);
    }
  }
});

test('offline deep links open the shell of the right studio', async ({page, context}) => {
  for (const slug of STUDIOS) {
    await page.goto(`/s/${slug}/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await controlledBy(page, slug);
  }
  await context.setOffline(true);
  try {
    for (const slug of STUDIOS) {
      const t = tenant(slug);
      await page.goto(`/s/${slug}/bookings`);
      await expect(page).toHaveTitle(t.name);
      expect(bootOf(await page.content())).toMatchObject({slug, app: 'client'});
      await page.goto(`/s/${slug}/owner/stats`);
      await expect(page).toHaveTitle(`${t.name} — кабинет`);
      expect(bootOf(await page.content())).toMatchObject({slug, app: 'owner'});
    }
  } finally {
    await context.setOffline(false);
  }
});

test('a new worker version is offered to the user and applied on request', async ({page}) => {
  const swFile = resolve(DIST_DIR, 'sw.js');
  const original = readFileSync(swFile, 'utf8');
  await page.goto('/s/graphite/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await controlledBy(page, 'graphite');
  const before = await page.evaluate(() => navigator.serviceWorker.controller!.scriptURL);
  try {
    writeFileSync(swFile, `${original}\n// e2e update ${Date.now()}\n`);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    const prompt = page.getByTestId('update-prompt');
    await expect(prompt).toBeVisible({timeout: 20_000});
    await expect(prompt).toContainText('Доступна новая версия');
    const reloaded = page.waitForEvent('load');
    await prompt.getByRole('button', {name: 'Обновить'}).click();
    await reloaded;
    await controlledBy(page, 'graphite');
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return {waiting: Boolean(reg?.waiting), url: navigator.serviceWorker.controller?.scriptURL};
    });
    expect(state).toEqual({waiting: false, url: before});
    await expect(page.getByTestId('update-prompt')).toHaveCount(0);
  } finally {
    writeFileSync(swFile, original);
  }
});
