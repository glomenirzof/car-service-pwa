// Dev server: serves /s/<slug>/... with the right tenant shell (same renderer
// as the production build) and /t/<slug>/... from generated assets.
import type {Plugin, ViteDevServer} from 'vite';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {join, resolve, extname} from 'node:path';
import {loadTenant} from '../tenant/lib/load.ts';
import {renderShell} from '../tenant/lib/shell.ts';
import {localOwnerSession} from '../dev-owner-session.ts';

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

export function tenantDevPlugin(generatedDir: string): Plugin {
  const root = resolve(import.meta.dirname, '../..');
  return {
    name: 'tenant-dev-shell',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        // `npm run demo` only: one-click owner login against the local demo
        // database (no Supabase Auth locally). Never part of a build.
        const demo = url.pathname.match(/^\/__demo\/owner\/([a-z0-9-]+)\/?$/);
        if (demo) {
          const databaseUrl = process.env.DEMO_OWNER_DATABASE_URL;
          const secret = process.env.DEMO_OWNER_JWT_SECRET;
          const issuer = process.env.DEMO_OWNER_JWT_ISSUER;
          if (!databaseUrl || !secret || !issuer) return next();
          const slug = demo[1]!;
          if (!loadTenant(slug).ok) {
            res.statusCode = 404;
            res.end(`Unknown tenant ${slug}`);
            return;
          }
          try {
            const s = await localOwnerSession({databaseUrl, secret, issuer, slug, email: `owner@${slug}.demo`});
            const script = `localStorage.setItem(${JSON.stringify(s.storageKey)}, ${JSON.stringify(JSON.stringify(s.session))});location.replace(${JSON.stringify(`/s/${slug}/owner/`)});`;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(`<!doctype html><meta charset="utf-8"><title>Вход в демо-кабинет</title><script>${script.replace(/</g, '\\u003c')}</script>`);
          } catch (error) {
            res.statusCode = 500;
            res.end(`demo owner login failed: ${(error as Error).message}`);
          }
          return;
        }
        const asset = url.pathname.match(/^\/t\/([a-z0-9-]+)\/(.+)$/);
        if (asset) {
          const file = join(generatedDir, 't', asset[1]!, asset[2]!);
          if (existsSync(file) && statSync(file).isFile()) {
            res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
            res.end(readFileSync(file));
            return;
          }
          res.statusCode = 404;
          res.end('asset not generated — run npm run tenant:assets');
          return;
        }
        const shell = url.pathname.match(/^\/s\/([a-z0-9-]+)(\/owner)?(?:\/|$)/);
        if (!shell || (req.headers.accept ?? '').indexOf('text/html') === -1) return next();
        const loaded = loadTenant(shell[1]!);
        if (!loaded.ok) {
          res.statusCode = 404;
          res.end(`Unknown tenant ${shell[1]}: ${'errors' in loaded ? loaded.errors.join('; ') : ''}`);
          return;
        }
        const kind = shell[2] ? 'owner' : 'client';
        const template = readFileSync(join(root, 'shell', `${kind}.html`), 'utf8');
        const html = await server.transformIndexHtml(url.pathname, renderShell(template, loaded.config, kind));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
      });
    },
  };
}
