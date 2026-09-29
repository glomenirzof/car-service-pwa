// One service worker script (/sw.js) registered once per studio with the
// studio's own scope, so caches and push subscriptions never mix between
// studios on the same origin.
import {Workbox} from 'workbox-window';

let wb: Workbox | null = null;

export function registerStudioWorker(slug: string, onUpdateReady?: (apply: () => void) => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  wb = new Workbox('/sw.js', {scope: `/s/${slug}/`, type: 'classic'});
  wb.addEventListener('waiting', () => {
    onUpdateReady?.(() => {
      wb?.addEventListener('controlling', () => window.location.reload());
      wb?.messageSkipWaiting();
    });
  });
  void wb.register().catch((error) => console.warn('service worker registration failed', error));
}

export async function studioRegistration(slug: string): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration(`/s/${slug}/`);
  if (!reg) return null;
  if (reg.active) return reg;
  return navigator.serviceWorker.ready;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushKeys = {endpoint: string; keys: {p256dh: string; auth: string}};

export async function subscribeToPush(slug: string, vapidPublicKey: string): Promise<PushKeys> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'denied' : 'dismissed');
  const reg = await studioRegistration(slug);
  if (!reg) throw new Error('no-service-worker');
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)}));
  const json = sub.toJSON() as {endpoint?: string; keys?: {p256dh?: string; auth?: string}};
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('bad-subscription');
  return {endpoint: json.endpoint, keys: {p256dh: json.keys.p256dh, auth: json.keys.auth}};
}

export async function currentPushEndpoint(slug: string): Promise<string | null> {
  const reg = await studioRegistration(slug);
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}
