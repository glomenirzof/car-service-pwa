#!/usr/bin/env tsx
// npm run cloud:login — signs this computer in to Supabase and Cloudflare
// (each opens the browser once). Tokens are stored by the tools themselves.
import {SUPABASE_CLI, WRANGLER, fail, ok, runNpx, say} from './common.ts';

say('Вход в Supabase: откроется браузер, подтвердите вход и вернитесь сюда.');
if (runNpx([SUPABASE_CLI, 'login']) !== 0) fail('Вход в Supabase не завершился. Запустите команду ещё раз.');
ok('Supabase: вход выполнен');

say('\nВход в Cloudflare: откроется браузер, нажмите Allow и вернитесь сюда.');
if (runNpx([WRANGLER, 'login']) !== 0) fail('Вход в Cloudflare не завершился. Запустите команду ещё раз.');
ok('Cloudflare: вход выполнен');
