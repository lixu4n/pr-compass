import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // automation tests run in node; everything else in jsdom
    environmentMatchGlobs: [
      ['tests/automation/**', 'node'],
    ],
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'sample-project/tests/**/*.test.ts',
    ],
  },
})
