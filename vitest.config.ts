import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/test/**/*.test.ts', 'shared/**/*.test.ts'],
    globalSetup: ['./server/test/globalSetup.ts'],
    setupFiles: ['./server/test/env.ts'],
    // One shared test database; files run serially so resets never race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
