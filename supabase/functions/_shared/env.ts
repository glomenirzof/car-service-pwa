// Server configuration. Secrets (service role, LLM key, VAPID private key,
// token secret) exist only here, in Edge Function secrets — never in the browser.
export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name);
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing environment variable ${name}`);
}

export function envInt(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function optionalEnv(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v === undefined || v === '' ? undefined : v;
}

/** Database URL: SUPABASE_DB_URL is provided automatically in hosted Edge Functions. */
export function databaseUrl(): string {
  return env('SUPABASE_DB_URL', Deno.env.get('DATABASE_URL') ?? undefined);
}

export function allowedOrigins(): string[] {
  return (optionalEnv('ALLOWED_ORIGINS') ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
}
