import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { createPrismaClient } from '../apps/api/src/db.js';
import { projectRoot } from './route-manifest.js';

const date = z.string().datetime({ offset: true }).transform(value => new Date(value));
const nullableText = z.string().nullable();
const common = { id: z.string().min(1), createdAt: date, updatedAt: date };
const dataSchema = z.object({
  news: z.array(z.object({ ...common, title: z.string(), slug: z.string(), content: z.string(), summary: nullableText, imageUrl: nullableText, published: z.boolean() }).strict()),
  events: z.array(z.object({ ...common, title: z.string(), description: z.string(), location: nullableText, startDate: date, endDate: date.nullable(), imageUrl: nullableText, published: z.boolean() }).strict()),
  team: z.array(z.object({ ...common, name: z.string(), position: z.string(), bio: nullableText, photoUrl: nullableText, order: z.number().int(), socials: z.record(z.string(), z.string()).nullable() }).strict()),
}).strict();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required. Configure the new PostgreSQL database; the archived SQLite database is never used as runtime data.');
const source = dataSchema.parse(JSON.parse(await readFile(resolve(projectRoot, 'data/legacy-content.json'), 'utf8')));
const prisma = await createPrismaClient(databaseUrl);

function assertFieldsMatch(expected: Record<string, unknown>, actual: Record<string, unknown> | null, label: string): void {
  if (!actual) throw new Error(`Import verification failed: ${label} is missing.`);
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (field === 'socials' && expectedValue === Prisma.DbNull) continue;
    const actualValue = actual[field];
    const a = actualValue instanceof Date ? actualValue.toISOString() : actualValue;
    const b = expectedValue instanceof Date ? expectedValue.toISOString() : expectedValue;
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Import verification failed: ${label}.${field} differs.`);
  }
}

try {
  await prisma.$transaction(async tx => {
    for (const row of source.news) {
      const stored = await tx.news.upsert({ where: { id: row.id }, create: row, update: row });
      assertFieldsMatch(row, stored, `news/${row.id}`);
    }
    for (const row of source.events) {
      const stored = await tx.event.upsert({ where: { id: row.id }, create: row, update: row });
      assertFieldsMatch(row, stored, `events/${row.id}`);
    }
    for (const row of source.team) {
      const input = { ...row, socials: row.socials ?? Prisma.DbNull };
      const stored = await tx.teamMember.upsert({ where: { id: row.id }, create: input, update: input });
      assertFieldsMatch(row, stored, `team/${row.id}`);
    }
    const counts = await Promise.all([
      tx.news.count({ where: { id: { in: source.news.map(row => row.id) } } }),
      tx.event.count({ where: { id: { in: source.events.map(row => row.id) } } }),
      tx.teamMember.count({ where: { id: { in: source.team.map(row => row.id) } } }),
    ]);
    if (counts.some((count, index) => count !== [source.news.length, source.events.length, source.team.length][index])) {
      throw new Error('Import verification failed: source record counts differ.');
    }
  });
  console.log(`Verified idempotent content import: ${source.news.length} news, ${source.events.length} events, ${source.team.length} team members. IDs, timestamps, and content fields preserved; unrelated records retained.`);
} finally {
  await prisma.$disconnect();
}
