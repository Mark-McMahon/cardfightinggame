import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@cardgame/shared': fileURLToPath(new URL('./shared/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'sim/**/*.test.ts', 'client/**/*.test.ts'],
    environment: 'node',
  },
});
