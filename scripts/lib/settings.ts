// Settings for command-line scripts: `settings.env` (the one file a person
// fills in for the cloud launch, see settings.example.env) and `.env`.
// Values already present in the environment win. Imported only by CLI entry
// points, never by tests, so a production DATABASE_URL cannot leak into them.
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

export const ROOT_DIR = resolve(import.meta.dirname, '../..');
export const SETTINGS_FILE = resolve(ROOT_DIR, 'settings.env');

export function loadSettings(): void {
  for (const file of [SETTINGS_FILE, resolve(ROOT_DIR, '.env')]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/** Non-empty setting or undefined (`KEY=` in the file counts as not filled in). */
export function setting(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function isLocalDatabase(url: string): boolean {
  try {
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
