import { randomUUID } from 'node:crypto';
import type { AdminIdentity } from '../src/auth.js';
import type { AdminRecord, ContentInput, ContentRecord, Repository, Resource } from '../src/repository.js';

/** Disposable in-memory repository for HTTP boundary tests, never selected by production. */
export class MemoryRepository implements Repository {
  readonly admins = new Map<string, AdminRecord>();
  readonly sessions = new Map<string, { adminId: string; expiresAt: Date }>();
  readonly records: Record<Resource, Map<string, ContentRecord>> = { news: new Map(), events: new Map(), team: new Map() };
  async ping() {}
  async findAdmin(username: string) { return this.admins.get(username) ?? null; }
  async createAdmin(username: string, passwordHash: string) {
    const admin = { id: randomUUID(), username, passwordHash };
    this.admins.set(username, admin);
    return { id: admin.id, username };
  }
  async createSession(digest: string, adminId: string, expiresAt: Date) { this.sessions.set(digest, { adminId, expiresAt }); }
  async findSession(digest: string, now: Date): Promise<AdminIdentity | null> {
    const session = this.sessions.get(digest);
    if (!session || session.expiresAt <= now) return null;
    const admin = [...this.admins.values()].find(item => item.id === session.adminId);
    return admin ? { id: admin.id, username: admin.username } : null;
  }
  async deleteSession(digest: string) { this.sessions.delete(digest); }
  async list(resource: Resource, includeUnpublished = false) {
    return [...this.records[resource].values()].filter(item => resource === 'team' || includeUnpublished || ('published' in item && item.published));
  }
  async find(resource: Resource, key: string, includeUnpublished = false) {
    return (await this.list(resource, includeUnpublished)).find(item => resource === 'news' && !includeUnpublished ? 'slug' in item && item.slug === key : item.id === key) ?? null;
  }
  async create(resource: Resource, input: ContentInput) {
    if (resource === 'news' && [...this.records.news.values()].some(item => 'slug' in item && item.slug === input.slug)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as ContentRecord;
    this.records[resource].set(record.id, record);
    return record;
  }
  async update(resource: Resource, id: string, input: ContentInput) {
    const existing = this.records[resource].get(id);
    if (!existing) throw Object.assign(new Error('Not found'), { code: 'P2025' });
    if (resource === 'news' && [...this.records.news.values()].some(item => item.id !== id && 'slug' in item && item.slug === input.slug)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    const record = { ...existing, ...input, updatedAt: new Date().toISOString() } as ContentRecord;
    this.records[resource].set(id, record);
    return record;
  }
  async delete(resource: Resource, id: string) { this.records[resource].delete(id); }
}
