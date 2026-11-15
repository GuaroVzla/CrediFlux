import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

/**
 * Singleton de PrismaClient para evitar agotar conexiones en serverless (Vercel).
 * Solo se instancia cuando DATABASE_URL está configurado.
 */
export function getPrisma() {
  if (!process.env.DATABASE_URL) return null;
  if (!globalForPrisma.__credifluxPrisma) {
    globalForPrisma.__credifluxPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return globalForPrisma.__credifluxPrisma;
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}
