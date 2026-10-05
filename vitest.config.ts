import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/__tests__/**/*.test.ts', 'apps/**/src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@workspace/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@workspace/adapters': path.resolve(__dirname, './packages/adapters/src/index.ts'),
      '@workspace/db': path.resolve(__dirname, './packages/db/src/index.ts'),
      '@workspace/prompts': path.resolve(__dirname, './packages/prompts/src/index.ts'),
      '@workspace/evals': path.resolve(__dirname, './packages/evals/src/index.ts'),
    },
  },
});
