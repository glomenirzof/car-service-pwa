/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_FUNCTIONS_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_STORAGE_PUBLIC_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
