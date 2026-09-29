// Build-time public configuration (shared by every tenant: one Supabase project).
// Never put secrets here: everything in import.meta.env.VITE_* ships to browsers.
export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? '',
  supabaseKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '',
  // Optional override, e.g. http://127.0.0.1:54321/functions/v1 for the local function server.
  functionsUrl: (import.meta.env.VITE_FUNCTIONS_URL as string | undefined)?.replace(/\/$/, '') ?? '',
  vapidPublicKey: (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '',
  storagePublicBase: (import.meta.env.VITE_STORAGE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') ?? '',
};

export function functionsBase(): string {
  if (env.functionsUrl) return env.functionsUrl;
  if (env.supabaseUrl) return `${env.supabaseUrl}/functions/v1`;
  return '/functions/v1';
}

export function storagePublicUrl(path: string): string {
  const base = env.storagePublicBase || (env.supabaseUrl ? `${env.supabaseUrl}/storage/v1/object/public/tenant-media` : '');
  return `${base}/${path}`;
}
