// Storage access that never throws (private mode, blocked storage).
export const safeStorage = {
  get<T>(key: string, fallback: T, area: 'local' | 'session' = 'local'): T {
    try {
      const raw = (area === 'local' ? localStorage : sessionStorage).getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown, area: 'local' | 'session' = 'local') {
    try {
      (area === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: the app keeps working in memory */
    }
  },
  remove(key: string, area: 'local' | 'session' = 'local') {
    try {
      (area === 'local' ? localStorage : sessionStorage).removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
