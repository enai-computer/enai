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
    environment: 'node',
    // Remove explicit tsconfig references here
    // Let Vitest discover tsconfig.test.json
  },
  // Remove esbuild override
});
