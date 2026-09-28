const { createRequire } = require('node:module');
const { fixupPluginRules } = require('@eslint/compat');
const js = require('@eslint/js');
const globals = require('globals');
const toolingRequire = createRequire(
  require.resolve('./.erb/tooling/package.json'),
);
const tsPlugin = toolingRequire('@typescript-eslint/eslint-plugin');
const tsParser = toolingRequire('@typescript-eslint/parser');
const imports = fixupPluginRules(require('eslint-plugin-import'));
const promise = require('eslint-plugin-promise');
const compat = require('eslint-plugin-compat');
const prettier = require('eslint-plugin-prettier/recommended');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '.erb/dll/**',
      'release/app/dist/**',
      'release/build/**',
      'coverage/**',
      '**/*.css.d.ts',
      '**/*.sass.d.ts',
      '**/*.scss.d.ts',
    ],
  },
  {
    files: ['**/*.{js,ts,cjs}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: imports,
      promise,
      compat,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...imports.configs.recommended.rules,
      'import/no-unresolved': 'off',
      ...promise.configs.recommended.rules,
      ...compat.configs.recommended.rules,
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  { files: ['**/*.ts'], rules: { 'no-undef': 'off' } },
  prettier,
];
