import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': root },
  },
  test: {
    environment: 'node',
    include: [
      'app/**/*.test.{ts,js}',
      'components/**/*.test.{ts,js}',
      'hooks/**/*.test.{ts,js}',
      'modules/**/*.test.{ts,js}',
      'server/**/*.test.{ts,js}',
      'shared/**/*.test.{ts,js}',
      'prisma/**/*.test.{ts,js}',
      'supabase/**/*.test.{ts,js}',
      'scripts/**/*.test.{ts,js}',
    ],
    globals: true
  }
});
