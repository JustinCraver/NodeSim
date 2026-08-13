import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    isolate: true,
    threads: false,
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});
