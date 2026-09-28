#!/usr/bin/env node
// Static server for dist/ that applies the generated Cloudflare Pages
// `_redirects` (200 rewrites with :placeholders and splats) and `_headers`.
// Used by `npm run preview` and Playwright, so deep-link behaviour is tested
// with the exact rules that get deployed.
import {createServer} from 'node:http';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {join, extname, resolve, normalize} from 'node:path';

const root = resolve(process.env.DIST_DIR ?? 'dist');
const port = Number(process.env.PORT ?? 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.map': 'application/json', '.ico': 'image/x-icon',
};

function parseRedirects() {
  const file = join(root, '_redirects');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
    const [from, to, status = '301'] = line.split(/\s+/);
    const names = [];
    const pattern = from.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }).replace(/\*/g, () => { names.push('splat'); return '(.*)'; });
    return {re: new RegExp(`^${pattern}$`), names, to, status: Number(status)};
  });
}

function parseHeaders() {
  const file = join(root, '_headers');
  if (!existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!raw.startsWith(' ')) {
      current = {re: new RegExp(`^${raw.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`), headers: {}};
      rules.push(current);
    } else if (current) {
      const i = raw.indexOf(':');
      current.headers[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    }
  }
  return rules;
}

const redirects = parseRedirects();
const headerRules = parseHeaders();

function resolveFile(pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, safe);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = resolveFile(url.pathname);
  let status = 200;
  if (!file) {
    for (const r of redirects) {
      const m = url.pathname.match(r.re);
      if (!m) continue;
      let target = r.to;
      r.names.forEach((n, i) => { target = target.replace(n === 'splat' ? ':splat' : `:${n}`, m[i + 1] ?? ''); });
      if (r.status === 200) { file = resolveFile(target); break; }
      res.writeHead(r.status, {Location: target});
      res.end();
      return;
    }
  }
  if (!file) { status = 404; file = null; }
  for (const rule of headerRules) if (rule.re.test(url.pathname)) for (const [k, v] of Object.entries(rule.headers)) res.setHeader(k, v);
  if (!file) { res.writeHead(404, {'Content-Type': 'text/plain'}); res.end('Not found'); return; }
  res.writeHead(status, {'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream'});
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
