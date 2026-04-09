import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/openrouter-image.ts', 'src/openrouter-text.ts', 'src/redis.ts', 'src/env.ts', 'src/logger.ts', 'src/scripts/**/*.ts'],
    },
  },
});
