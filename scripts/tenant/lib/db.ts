import postgres from 'postgres';

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      'Не задан адрес базы DATABASE_URL. Для Supabase впишите его в settings.env (кнопка Connect → Session pooler), для локальной базы: npm run db:local.',
    );
    process.exit(2);
  }
  return url;
}

export function connect() {
  return postgres(databaseUrl(), {max: 1, onnotice: () => {}, prepare: false});
}
