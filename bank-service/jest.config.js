/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  moduleFileExtensions: ['js', 'json'],
  collectCoverage: true,
  coverageDirectory: 'coverage-jest',
  coverageReporters: ['text', 'lcov', 'json-summary', 'json'],
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '.',
        outputName: 'junit.xml',
        addFileAttribute: 'true',
        ancestorSeparator: ' > ',
      },
    ],
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/config/bank.logger.js',
    '<rootDir>/src/config/bank.database.js',
    '<rootDir>/src/index.js' // ponto de entrada do servidor
  ],
  setupFiles: ['<rootDir>/.jest/setEnv.js'],
  // Thresholds para esteira CI
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80,
    },
  },
};
