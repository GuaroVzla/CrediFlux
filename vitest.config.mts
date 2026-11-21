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
      'app/**/*.test.{ts,tsx,js}',
      'components/**/*.test.{ts,tsx,js}',
      'hooks/**/*.test.{ts,tsx,js}',
      'modules/**/*.test.{ts,tsx,js}',
      'server/**/*.test.{ts,tsx,js}',
      'shared/**/*.test.{ts,tsx,js}',
      'prisma/**/*.test.{ts,tsx,js}',
      'supabase/**/*.test.{ts,tsx,js}',
      'scripts/**/*.test.{ts,tsx,js}',
    ],
    globals: true
  }
});
