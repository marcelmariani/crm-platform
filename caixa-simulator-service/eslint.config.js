// eslint.config.js
export default [
  {
    files: ['*.js', 'src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node globals
        process: 'readonly',
        __dirname: 'readonly',
        // Jest globals (ajuste paths se for diferente)
        describe: 'readonly',
        it: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        expect: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      eqeqeq: ['warn', 'always'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      strict: ['error', 'never'],
    },
  },
];
