// Platform facts that decide what we can honestly promise the user.
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?: boolean}).standalone === true;
}

export type PushSupport =
  | {ok: true}
  | {ok: false; reason: 'ios-not-installed' | 'unsupported' | 'denied' | 'not-configured'};

export function pushSupport(vapidKey: string): PushSupport {
  if (!vapidKey) return {ok: false, reason: 'not-configured'};
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // iOS/iPadOS deliver Web Push only to web apps added to the Home Screen (16.4+).
  if (isIOS() && !isStandalone()) return {ok: false, reason: 'ios-not-installed'};
  if (!hasApi) return {ok: false, reason: 'unsupported'};
  if (Notification.permission === 'denied') return {ok: false, reason: 'denied'};
  return {ok: true};
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
