import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

const alias = {
  '@': resolve(import.meta.dirname, 'src'),
  '@shared': resolve(import.meta.dirname, 'supabase/functions/_shared/core'),
};

export default defineConfig({
  resolve: {alias},
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {alias},
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
          setupFiles: ['./src/test/setup.ts'],
          globals: true,
          css: false,
        },
      },
      {
        resolve: {alias},
        test: {
          name: 'sql',
          environment: 'node',
          include: ['tests/sql/**/*.test.ts'],
          globalSetup: ['./tests/sql/global-setup.ts'],
          globals: true,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
