/// <reference lib="webworker" />
// One service worker source, registered once per studio with scope /s/<slug>/.
// Everything that is cached is named after that scope, so studios never share
// or overwrite each other's caches. Only public static files are cached:
// API responses (Supabase Edge Functions, cross-origin) are never intercepted,
// so no personal or owner data can end up in a worker cache.
import {precacheAndRoute, cleanupOutdatedCaches} from 'workbox-precaching';
import {registerRoute} from 'workbox-routing';
import {StaleWhileRevalidate} from 'workbox-strategies';
import {ExpirationPlugin} from 'workbox-expiration';
import {setCacheNameDetails} from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{url: string; revision: string | null}>;
};

const scopeUrl = new URL(self.registration.scope);
const scopeMatch = scopeUrl.pathname.match(/^\/s\/([a-z0-9-]+)\/$/);
const SLUG = scopeMatch?.[1] ?? 'unscoped';
const PREFIX = `svc-${SLUG}`;
const SHELL_CACHE = `${PREFIX}-shell-v1`;
const STATIC_CACHE = `${PREFIX}-static-v1`;
const CLIENT_SHELL = `/s/${SLUG}/`;
const OWNER_SHELL = `/s/${SLUG}/owner/`;

setCacheNameDetails({prefix: PREFIX, suffix: 'v1', precache: 'precache', runtime: 'runtime'});

// Shared hashed JS/CSS of the single build (one copy per studio registration).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled([cache.add(new Request(CLIENT_SHELL, {cache: 'reload'})), cache.add(new Request(OWNER_SHELL, {cache: 'reload'}))]),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches of older versions of THIS studio only.
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith(`${PREFIX}-`) && !name.includes('precache') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

// Navigations inside this studio: network first; offline -> the cached shell of
// the same studio (client or owner app). Deep links therefore open the right shell.
registerRoute(
  ({request, url}) => request.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith(CLIENT_SHELL),
  async ({request, url}) => {
    const shellKey = url.pathname.startsWith(OWNER_SHELL) ? OWNER_SHELL : CLIENT_SHELL;
    try {
      const response = await fetch(request);
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(shellKey, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(shellKey, {cacheName: SHELL_CACHE});
      if (cached) return cached;
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Нет сети</title><body style="font:16px system-ui;background:#0b0c0e;color:#eee;padding:24px">Нет соединения. Проверьте интернет и обновите страницу.</body>',
        {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8'}},
      );
    }
  },
);

// Public static assets of this studio only (icons, photos, manifests).
registerRoute(
  ({url}) => url.origin === self.location.origin && url.pathname.startsWith(`/t/${SLUG}/`),
  new StaleWhileRevalidate({
    cacheName: STATIC_CACHE,
    plugins: [new ExpirationPlugin({maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600})],
  }),
);

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

type PushPayload = {title: string; body: string; url?: string; tag?: string};

self.addEventListener('push', (event) => {
  let payload: PushPayload;
  try {
    payload = event.data?.json() as PushPayload;
  } catch {
    payload = {title: 'Уведомление', body: event.data?.text() ?? ''};
  }
  const url = payload.url && payload.url.startsWith(CLIENT_SHELL) ? payload.url : CLIENT_SHELL;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: {url},
      icon: `/t/${SLUG}/icons/icon-192.png`,
      badge: `/t/${SLUG}/icons/icon-192.png`,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as {url?: string})?.url ?? CLIENT_SHELL, self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
      for (const client of windows) {
        if (new URL(client.url).pathname.startsWith(CLIENT_SHELL) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await (client as WindowClient).navigate(target.href);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data as {type?: string} | undefined;
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
