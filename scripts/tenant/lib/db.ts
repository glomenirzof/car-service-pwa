import postgres from 'postgres';

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL не задан. Для Supabase: Project Settings → Database → Connection string (URI, session pooler), для локальной БД: npm run db:local.',
    );
  }
  return url;
}

export function connect() {
  return postgres(databaseUrl(), {max: 1, onnotice: () => {}, prepare: false});
}
