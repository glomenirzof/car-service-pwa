import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', '.generated', '.tmp', 'node_modules', 'playwright-report', 'test-results', 'theme.template.ts', 'supabase/functions/**/*.deno.ts'],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {...globals.browser, ...globals.node},
    },
    plugins: {'react-hooks': reactHooks},
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', varsIgnorePattern: '^_'}],
      '@typescript-eslint/consistent-type-imports': ['error', {fixStyle: 'inline-type-imports'}],
      'no-restricted-syntax': [
        'error',
        {
          // Business-specific strings belong in tenants/*/business.json, never in the shared source.
          selector: "Literal[value=/GRAPHITE|RotorLab|Ротор/i]",
          message: 'Business names must not appear in src/ — use business.json.',
        },
      ],
    },
  },
  {
    files: ['supabase/functions/**/*.ts'],
    languageOptions: {globals: {...globals.browser, Deno: 'readonly'}},
  },
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts', 'scripts/**/*.ts', '**/*.test.{ts,tsx}'],
    rules: {'no-restricted-syntax': 'off', '@typescript-eslint/no-non-null-assertion': 'off'},
  },
);
