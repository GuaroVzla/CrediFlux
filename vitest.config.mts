import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'app/**/*.test.{ts,js}',
      'lib/**/*.test.{ts,js}',
      'prisma/**/*.test.{ts,js}',
      'supabase/**/*.test.{ts,js}'
    ],
    globals: true
  }
})