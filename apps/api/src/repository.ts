import type { News, Event, TeamMember } from '@aet/contracts';
import type { AdminIdentity } from './auth.js';

export type Resource = 'news' | 'events' | 'team';
export type ContentRecord = News | Event | TeamMember;
export type ContentInput = Record<string, unknown>;
export type AdminRecord = AdminIdentity & { passwordHash: string };
export interface Repository {
  ping(): Promise<void>;
  findAdmin(username: string): Promise<AdminRecord | null>;
  createAdmin(username: string, passwordHash: string): Promise<AdminIdentity>;
  createSession(digest: string, adminId: string, expiresAt: Date): Promise<void>;
  findSession(digest: string, now: Date): Promise<AdminIdentity | null>;
  deleteSession(digest: string): Promise<void>;
  list(resource: Resource, includeUnpublished?: boolean): Promise<ContentRecord[]>;
  find(resource: Resource, key: string, includeUnpublished?: boolean): Promise<ContentRecord | null>;
  create(resource: Resource, input: ContentInput): Promise<ContentRecord>;
  update(resource: Resource, id: string, input: ContentInput): Promise<ContentRecord>;
  delete(resource: Resource, id: string): Promise<void>;
  close?(): Promise<void>;
}

function serialize(record: unknown): ContentRecord {
  // Prisma Date objects and JSON fields become the same JSON-safe DTO as the HTTP boundary.
  return JSON.parse(JSON.stringify(record)) as ContentRecord;
}

export async function createPrismaRepository(databaseUrl: string): Promise<Repository> {
  const { createPrismaClient } = await import('./db.js');
  const { Prisma: PrismaRuntime } = await import('@prisma/client');
  const db = createPrismaClient(databaseUrl);
  // Prisma's model delegate methods are generic. Avoid Parameters<typeof delegate.method>[0],
  // which collapses the argument type to unknown under strict TypeScript.
  // Keep nullable JSON semantics: an explicit null means SQL NULL, not JSON null.
  const dbNull = (PrismaRuntime as unknown as {
    DbNull?: unknown;
  }).DbNull;

  const teamData = (input: ContentInput): Record<string, unknown> => {
    const data: Record<string, unknown> = { ...input };
    if ('socials' in input && input.socials === null) {
      if (dbNull === undefined) {
        throw new Error('Prisma Client belum sinkron dengan schema. Jalankan npm run db:generate.');
      }
      data.socials = dbNull;
    }
    return data;
  };
  return {
    async ping() { await db.$queryRaw`SELECT 1`; },
    findAdmin: username => db.admin.findUnique({ where: { username } }),
    createAdmin: (username, passwordHash) => db.admin.create({ data: { username, passwordHash }, select: { id: true, username: true } }),
    async createSession(id, adminId, expiresAt) {
      await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await db.session.create({ data: { id, adminId, expiresAt } });
    },
    async findSession(id, now) {
      const session = await db.session.findUnique({ where: { id }, include: { admin: true } });
      return session && session.expiresAt > now ? { id: session.admin.id, username: session.admin.username } : null;
    },
    async deleteSession(id) { await db.session.deleteMany({ where: { id } }); },
    async list(resource, includeUnpublished = false) {
      if (resource === 'news') return (await db.news.findMany({ where: includeUnpublished ? {} : { published: true }, orderBy: { createdAt: 'desc' } })).map(serialize);
      if (resource === 'events') return (await db.event.findMany({ where: includeUnpublished ? {} : { published: true }, orderBy: { startDate: 'asc' } })).map(serialize);
      return (await db.teamMember.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] })).map(serialize);
    },
    async find(resource, key, includeUnpublished = false) {
      let record;
      if (resource === 'news') record = await db.news.findFirst({ where: { ...(includeUnpublished ? { id: key } : { slug: key }), ...(includeUnpublished ? {} : { published: true }) } });
      else if (resource === 'events') record = await db.event.findFirst({ where: { id: key, ...(includeUnpublished ? {} : { published: true }) } });
      else record = await db.teamMember.findUnique({ where: { id: key } });
      return record ? serialize(record) : null;
    },
    async create(resource, input) {
      if (resource === 'news') return serialize(await db.news.create({ data: input as never }));
      if (resource === 'events') return serialize(await db.event.create({ data: input as never }));
      return serialize(await db.teamMember.create({ data: teamData(input) as never }));
    },
    async update(resource, id, input) {
      if (resource === 'news') return serialize(await db.news.update({ where: { id }, data: input as never }));
      if (resource === 'events') return serialize(await db.event.update({ where: { id }, data: input as never }));
      return serialize(await db.teamMember.update({ where: { id }, data: teamData(input) as never }));
    },
    async delete(resource, id) {
      if (resource === 'news') await db.news.delete({ where: { id } });
      else if (resource === 'events') await db.event.delete({ where: { id } });
      else await db.teamMember.delete({ where: { id } });
    },
    close: () => db.$disconnect(),
  };
}
