import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// `shared` is raw TS (entry is ./index.ts), so alias it to the source file exactly like
// vitest.config.ts / tsconfig paths do — Vite/esbuild compiles it inline. Keeping it out of
// dep-optimization avoids esbuild trying to pre-bundle a workspace of loose .ts modules.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cardgame/shared': fileURLToPath(new URL('../shared/index.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['@cardgame/shared'],
  },
  server: { port: 5173 },
});
