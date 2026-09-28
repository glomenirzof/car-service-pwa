// Client-side state that belongs to this device only:
//  * access tokens of the client's own bookings (the booking link),
//  * remembered contact details (opt-in),
//  * the idempotency key of the booking being submitted (so a retry after a
//    lost response reuses it and gets the same booking and link back).
import {useSyncExternalStore} from 'react';
import {safeStorage} from '@/shared/storage';

export type SavedBooking = {token: string; bookingId: string; startAt: string; serviceName: string; savedAt: string};
export type Contact = {name: string; phone: string; car: string; carPlate: string};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key?.startsWith('bookings:') && l();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
};

const bookingsKey = (slug: string) => `bookings:${slug}`;
const cache = new Map<string, {raw: string; value: SavedBooking[]}>();

export function getSavedBookings(slug: string): SavedBooking[] {
  const value = safeStorage.get<SavedBooking[]>(bookingsKey(slug), []);
  const raw = JSON.stringify(value);
  const hit = cache.get(slug);
  if (hit && hit.raw === raw) return hit.value;
  cache.set(slug, {raw, value});
  return value;
}

export function useSavedBookings(slug: string): SavedBooking[] {
  return useSyncExternalStore(subscribe, () => getSavedBookings(slug), () => []);
}

export function saveBooking(slug: string, entry: Omit<SavedBooking, 'savedAt'>) {
  const list = getSavedBookings(slug).filter((b) => b.bookingId !== entry.bookingId);
  safeStorage.set(bookingsKey(slug), [{...entry, savedAt: new Date().toISOString()}, ...list].slice(0, 30));
  emit();
}

export function updateSavedBooking(slug: string, bookingId: string, patch: Partial<SavedBooking>) {
  safeStorage.set(
    bookingsKey(slug),
    getSavedBookings(slug).map((b) => (b.bookingId === bookingId ? {...b, ...patch} : b)),
  );
  emit();
}

export function forgetBooking(slug: string, bookingId: string) {
  safeStorage.set(bookingsKey(slug), getSavedBookings(slug).filter((b) => b.bookingId !== bookingId));
  emit();
}

export function tokenFor(slug: string, bookingId: string): string | null {
  return getSavedBookings(slug).find((b) => b.bookingId === bookingId)?.token ?? null;
}

export function getContact(slug: string): Contact | null {
  return safeStorage.get<Contact | null>(`contact:${slug}`, null);
}

export function setContact(slug: string, contact: Contact | null) {
  if (contact) safeStorage.set(`contact:${slug}`, contact);
  else safeStorage.remove(`contact:${slug}`);
}

/**
 * Idempotency key for one concrete submission. The same payload keeps the
 * same key (retries replay), a changed payload gets a new key (it is a
 * different request). Survives reloads within the tab via sessionStorage.
 */
export function idempotencyKeyFor(slug: string, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  const stored = safeStorage.get<{fingerprint: string; key: string} | null>(`submit:${slug}`, null, 'session');
  if (stored && stored.fingerprint === fingerprint) return stored.key;
  const key = crypto.randomUUID();
  safeStorage.set(`submit:${slug}`, {fingerprint, key}, 'session');
  return key;
}

export function clearIdempotencyKey(slug: string) {
  safeStorage.remove(`submit:${slug}`, 'session');
}
