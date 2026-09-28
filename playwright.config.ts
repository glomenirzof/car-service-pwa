import {existsSync} from 'node:fs';
import {defineConfig, devices, chromium} from '@playwright/test';
import {SITE_URL} from './e2e/support/env.ts';

// Use the Chromium bundled with this Playwright version when it is installed,
// otherwise a preinstalled one (CI images / sandboxes): PW_CHROMIUM overrides.
const bundled = chromium.executablePath();
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(bundled) ? undefined : '/opt/pw-browsers/chromium');

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {timeout: 10_000},
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: SITE_URL,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {executablePath},
  },
  projects: [{name: 'mobile-chromium', use: {...devices['Pixel 7'], launchOptions: {executablePath}}}],
});
