/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
// import tsconfigPaths from 'vite-tsconfig-paths'; // Optional

// Keep the config minimal and let Vitest use its defaults,
// hopefully picking up tsconfig.test.json automatically.
export default defineConfig({
  plugins: [
    // tsconfigPaths(), // Optional
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test-setup/electron-mocks.ts'],
    // Remove explicit tsconfig references here
    // Let Vitest discover tsconfig.test.json
    testTimeout: 900000, // 15 minutes default timeout
    hookTimeout: 30000, // 30 seconds for hooks
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error', // Only show errors in tests by default
    },
  },
  // Remove esbuild override
});
