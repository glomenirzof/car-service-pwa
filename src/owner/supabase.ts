// Supabase Auth for owners only (clients never sign in). Sessions are stored
// per studio so two cabinets on one device do not share a login.
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {env} from '@/shared/env';

let client: SupabaseClient | null = null;
let clientSlug = '';

export function authStorageKey(slug: string) {
  return `sb-owner-${slug}`;
}

export function supabase(slug: string): SupabaseClient {
  if (client && clientSlug === slug) return client;
  client = createClient(env.supabaseUrl || window.location.origin, env.supabaseKey || 'public-anon-key-not-configured', {
    auth: {
      storageKey: authStorageKey(slug),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  clientSlug = slug;
  return client;
}
