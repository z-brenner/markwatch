import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Privacy guardrail: no browser storage, cookies, service workers, or
// cross-context channels anywhere in app code. State lives in memory only;
// the case-file export is the only way to keep work. The Playwright guard
// test enforces the same rule at runtime.
const STORAGE_MSG = 'Markwatch keeps no browser storage. State is in memory; export a case file instead.';
const restrictedGlobals = ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'openDatabase', 'cookieStore'].map((name) => ({ name, message: STORAGE_MSG }));
const restrictedProperties = [
  ...['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore'].flatMap((property) => [
    { object: 'window', property, message: STORAGE_MSG },
    { object: 'globalThis', property, message: STORAGE_MSG },
    { object: 'self', property, message: STORAGE_MSG },
  ]),
  { object: 'document', property: 'cookie', message: STORAGE_MSG },
  { object: 'navigator', property: 'storage', message: STORAGE_MSG },
  { object: 'navigator', property: 'serviceWorker', message: STORAGE_MSG },
  { object: 'navigator', property: 'sendBeacon', message: 'No beacons. Network access goes through the Collector only.' },
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'research', 'test-results', 'playwright-report', '.claude'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-globals': ['error', ...restrictedGlobals],
      'no-restricted-properties': ['error', ...restrictedProperties],
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Never inject HTML; imported case files and lookup data are untrusted.' },
        { selector: "MemberExpression[property.name='innerHTML']", message: 'Never inject HTML.' },
        { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
        { selector: "NewExpression[callee.name='Function']", message: 'No Function constructor.' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'research/**', '*.config.*', 'eslint.config.js', 'tests/fixtures/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { projectService: false, project: null }, globals: { ...globals.node } },
  },
  {
    // Tests may install storage traps on these globals, so the source-level ban does not apply there.
    files: ['tests/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off', 'react-hooks/rules-of-hooks': 'off', '@typescript-eslint/require-await': 'off', '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/unbound-method': 'off' },
  },
);
