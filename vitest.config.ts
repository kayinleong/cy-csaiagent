import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'app/**/*.test.ts', 'scripts/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      // Mirror tsconfig.json: "@/*" -> "./*" from project root
      '@': path.resolve(__dirname, '.'),
    },
  },
})
