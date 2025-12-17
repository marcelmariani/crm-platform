// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    timeout: 30000,     // 30 segundos por teste/hook
    threads: false,     // roda sequencialmente (sem paralelismo)
    maxFailures: 1,     // para no primeiro erro    
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'], // Gera relatório JSON
      reportsDirectory: './coverage', // Diretório dos relatórios
      lines: 90,
      functions: 90,
      branches: 90,
      statements: 90
    }   
  }
});
