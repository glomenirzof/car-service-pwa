// Shared helpers for the `cloud:*` commands: messages for people who are not
// developers, settings.env handling and running npx tools on every OS.
import {spawn, spawnSync} from 'node:child_process';
import {copyFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createECDH, generateKeyPairSync, randomBytes} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {ROOT_DIR, SETTINGS_FILE, loadSettings, setting} from '../lib/settings.ts';

export {ROOT_DIR, SETTINGS_FILE, setting};

export const say = (s = '') => console.log(s);
export function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
export const ok = (s: string) => say(`✔ ${s}`);
export let warnings = 0;
export const warn = (s: string) => {
  warnings++;
  say(`! ${s}`);
};

/** Loads settings.env, creating it from the template on the first run. */
export function openSettings(): void {
  if (!existsSync(SETTINGS_FILE)) {
    copyFileSync(resolve(ROOT_DIR, 'settings.example.env'), SETTINGS_FILE);
    fail(`Создан файл settings.env в папке проекта. Заполните его по инструкции (START.md, часть Б, шаг 4) и запустите команду ещё раз.`);
  }
  loadSettings();
}

type Rule = {name: string; where: string; test?: (v: string) => boolean; hint?: string};

export const RULES: Record<string, Rule> = {
  SUPABASE_URL: {
    name: 'SUPABASE_URL',
    where: 'Supabase → Project Settings → Data API → Project URL',
    test: (v) => /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(v),
    hint: 'должно выглядеть как https://abcdefghijklmnop.supabase.co',
  },
  SUPABASE_PUBLISHABLE_KEY: {
    name: 'SUPABASE_PUBLISHABLE_KEY',
    where: 'Supabase → Project Settings → API Keys → Publishable key',
    test: (v) => v.startsWith('sb_publishable_') || v.startsWith('eyJ'),
    hint: 'ключ начинается с sb_publishable_',
  },
  SUPABASE_SECRET_KEY: {
    name: 'SUPABASE_SECRET_KEY',
    where: 'Supabase → Project Settings → API Keys → Secret keys',
    test: (v) => v.startsWith('sb_secret_') || v.startsWith('eyJ'),
    hint: 'ключ начинается с sb_secret_',
  },
  DATABASE_URL: {
    name: 'DATABASE_URL',
    where: 'Supabase → Connect → Session pooler',
    test: (v) => /^postgres(ql)?:\/\//.test(v) && !v.includes('[YOUR-PASSWORD]'),
    hint: 'строка начинается с postgresql:// и вместо [YOUR-PASSWORD] стоит ваш пароль базы',
  },
  ADMIN_EMAIL: {name: 'ADMIN_EMAIL', where: 'ваша почта', test: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), hint: 'нужен адрес почты'},
  SITE_NAME: {
    name: 'SITE_NAME',
    where: 'придумайте имя сайта',
    test: (v) => /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(v),
    hint: 'только маленькие латинские буквы, цифры и дефис, например my-autoservice',
  },
};

/** Stops with a readable list when required settings are missing or look wrong. */
export function requireSettings(...names: (keyof typeof RULES)[]): void {
  const problems: string[] = [];
  for (const key of names) {
    const rule = RULES[key]!;
    const value = setting(rule.name);
    if (!value) problems.push(`${rule.name} не заполнено (${rule.where})`);
    else if (rule.test && !rule.test(value)) problems.push(`${rule.name}: ${rule.hint}`);
  }
  if (problems.length) fail(`Проверьте settings.env:\n  - ${problems.join('\n  - ')}`);
}

export function projectRef(): string {
  return new URL(setting('SUPABASE_URL')!).hostname.split('.')[0]!;
}

export function supabaseUrl(): string {
  return setting('SUPABASE_URL')!.replace(/\/$/, '');
}

/**
 * Stores generated values in settings.env: an existing `KEY=` line is filled
 * in place, otherwise the line is appended. Lines the person typed stay as they are.
 */
export function appendSettings(entries: Record<string, string>): void {
  let text = readFileSync(SETTINGS_FILE, 'utf8');
  for (const [key, value] of Object.entries(entries)) {
    const line = new RegExp(`^${key}=.*$`, 'm');
    if (line.test(text)) text = text.replace(line, `${key}=${value}`);
    else text = `${text}${text.endsWith('\n') ? '' : '\n'}${key}=${value}\n`;
    process.env[key] = value;
  }
  writeFileSync(SETTINGS_FILE, text);
}

/** Web Push VAPID key pair: P-256, public key uncompressed, both base64url. */
export function generateVapidKeys(): {publicKey: string; privateKey: string} {
  const {privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const jwk = privateKey.export({format: 'jwk'});
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]);
  return {publicKey: publicKey.toString('base64url'), privateKey: jwk.d!};
}

/** Public key that belongs to a VAPID private key (used to double-check stored pairs). */
export function vapidPublicFromPrivate(privateKey: string): string {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
  return ecdh.getPublicKey().toString('base64url');
}

export const randomSecret = (bytes: number) => randomBytes(bytes).toString('hex');

// npm and npx are started through node itself (the CLI scripts next to
// npm_execpath), not through a shell: no quoting problems with spaces or
// Cyrillic in the project path on Windows.
function npmCli(): string {
  const cli = process.env.npm_execpath;
  if (!cli || !existsSync(cli)) fail('Запускайте команду через npm, например: npm run cloud:prepare');
  return cli;
}

function runNode(args: string[], env: Record<string, string | undefined>): number {
  const r = spawnSync(process.execPath, args, {cwd: ROOT_DIR, stdio: 'inherit', env: {...process.env, ...env}});
  if (r.error) fail(`Не удалось запустить команду: ${r.error.message}`);
  return r.status ?? 1;
}

/** npm <args> with visible output; returns the exit code. */
export function runNpm(args: string[], env: Record<string, string | undefined> = {}): number {
  return runNode([npmCli(), ...args], env);
}

// Tool versions checked against their --help (flags used below exist there).
export const SUPABASE_CLI = 'supabase@2.118.0';
export const WRANGLER = 'wrangler@4.143.0';

function npxCli(): string {
  const npx = resolve(dirname(npmCli()), 'npx-cli.js');
  if (!existsSync(npx)) fail(`Не найден npx рядом с npm (${npx}). Переустановите Node.js с nodejs.org.`);
  return npx;
}

/** npx --yes <args> with visible output; returns the exit code. */
export function runNpx(args: string[], env: Record<string, string | undefined> = {}): number {
  return runNode([npxCli(), '--yes', ...args], env);
}

/** npx --yes <args>, output shown and also returned (to read URLs or known errors from it). */
export function runNpxCapture(args: string[], opts: {echo?: boolean} = {}): Promise<{status: number; output: string}> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [npxCli(), '--yes', ...args], {cwd: ROOT_DIR, stdio: ['inherit', 'pipe', 'pipe']});
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (opts.echo !== false) process.stdout.write(chunk);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => done({status: code ?? 1, output}));
    child.on('error', (e) => done({status: 1, output: e.message}));
  });
}
