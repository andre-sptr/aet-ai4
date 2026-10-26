import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** Native pg adapter keeps query execution on PostgreSQL, with no local SQLite fallback. */
export function createPrismaClient(databaseUrl: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
