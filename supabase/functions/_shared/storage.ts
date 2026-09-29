// Supabase Storage for owner-uploaded photos (bucket tenant-media, public read).
// The service key stays in the function; the browser only receives a
// one-time signed upload URL for a path the server chose.
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {optionalEnv} from './env.ts';
import {HttpError} from './http.ts';

export const MEDIA_BUCKET = 'tenant-media';
let admin: SupabaseClient | null = null;

function storageAdmin(): SupabaseClient {
  const url = optionalEnv('SUPABASE_URL');
  const key = optionalEnv('SUPABASE_SERVICE_ROLE_KEY') ?? optionalEnv('SUPABASE_SECRET_KEY');
  if (!url || !key) throw new HttpError(503, 'storage_unavailable', 'Хранилище фото не настроено');
  admin ??= createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
  return admin;
}

const EXT: Record<string, string> = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};

export async function signedUpload(tenantId: string, contentType: string) {
  const path = `tenants/${tenantId}/owner/${crypto.randomUUID()}.${EXT[contentType]}`;
  const {data, error} = await storageAdmin().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new HttpError(502, 'storage_error', error?.message ?? 'upload url failed');
  return {path, signedUrl: data.signedUrl, token: data.token, bucket: MEDIA_BUCKET};
}

export async function objectExists(path: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  const name = path.slice(path.lastIndexOf('/') + 1);
  const {data, error} = await storageAdmin().storage.from(MEDIA_BUCKET).list(dir, {search: name, limit: 1});
  if (error) throw new HttpError(502, 'storage_error', error.message);
  return (data ?? []).some((o) => o.name === name);
}

export async function removeObject(path: string) {
  const {error} = await storageAdmin().storage.from(MEDIA_BUCKET).remove([path]);
  if (error) console.warn('storage remove failed', path, error.message);
}
