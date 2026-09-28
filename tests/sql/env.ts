export const TEMPLATE_DB = 'cs_test_template';

export function adminUrl(database?: string): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres');
  if (database) url.pathname = `/${database}`;
  return url.toString();
}
