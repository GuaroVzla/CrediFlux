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
      'app/**/*.test.{ts,tsx,js,jsx}',
      'components/**/*.test.{ts,tsx,js,jsx}',
      'hooks/**/*.test.{ts,tsx,js,jsx}',
      'modules/**/*.test.{ts,tsx,js,jsx}',
      'server/**/*.test.{ts,tsx,js,jsx}',
      'shared/**/*.test.{ts,tsx,js,jsx}',
      'prisma/**/*.test.{ts,tsx,js,jsx}',
      'supabase/**/*.test.{ts,tsx,js,jsx}',
      'scripts/**/*.test.{ts,tsx,js,jsx}',
    ],
    globals: true
  }
});
