import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-*/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/shell/public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/shell/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['packages/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // The SDK core must stay usable outside a browser. Only the explicit
    // browser adapter may read these globals.
    files: ['packages/plugin-sdk/src/**/*.ts'],
    ignores: [
      'packages/plugin-sdk/src/browser.ts',
      'packages/plugin-sdk/src/theme.ts',
      'packages/plugin-sdk/src/**/*.test.ts',
    ],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'location', 'parent'],
    },
  },
  {
    files: ['apps/shell/vite.config.ts', 'apps/shell/scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/shell/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Only the published kit's public entry points may be imported.
              regex:
                '^vscode-workbench/(?!react$|core$|elements/[\\w-]+$|styles/[\\w-]+\\.css$).+$',
              message:
                'Import only the kit public entry points: vscode-workbench, /react, /core, /elements/*, /styles/*.',
            },
            {
              group: ['**/apps/template/**', '**/demo/**', '**/mock-workspace/**'],
              message:
                'Exo composes the published kit; upstream demo, mock or vendored modules are banned.',
            },
          ],
        },
      ],
    },
  },
  prettier,
)
