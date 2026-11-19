import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Each test file builds its own app on its own temporary data folder.
    fileParallelism: true,
  },
});
