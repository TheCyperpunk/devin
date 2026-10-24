// Runs unit tests from every workspace with one command: npm test
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against shared sources, so they never depend on a prior `npm run build`.
    alias: { '@relief-mesh/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['shared/src/**/*.test.ts', 'server/src/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
  },
});
