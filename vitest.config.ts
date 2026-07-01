import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@cardgame/shared': fileURLToPath(new URL('./shared/index.ts', import.meta.url)),
      // sim imports the SAME server bot (invariant: no re-implementation). Alias the subpath
      // so vitest resolves it identically to tsc (tsconfig.base.json paths) and tsx (exports).
      '@cardgame/server/bots': fileURLToPath(new URL('./server/bots/BotAgent.ts', import.meta.url)),
    },
  },
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'sim/**/*.test.ts', 'client/**/*.test.ts'],
    environment: 'node',
  },
});
