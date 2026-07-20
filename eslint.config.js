import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
export default [
  { ignores: ['**/dist/**', 'node_modules/**', 'var/**'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        confirm: 'readonly',
        document: 'readonly',
        EventSource: 'readonly',
        setInterval: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: { ...tseslint.configs.recommended.rules, '@typescript-eslint/no-explicit-any': 'off' },
  },
];
