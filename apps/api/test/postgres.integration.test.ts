import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { createPrismaClient } from '../src/db.js';
import { createPrismaRepository } from '../src/repository.js';
import { hashPassword } from '../src/auth.js';

const databaseUrl = process.env.AET_TEST_DATABASE_URL;
test('real PostgreSQL: signed auth, persisted content CRUD, JSON/date fidelity, and publication safety', { skip: !databaseUrl ? 'Set AET_TEST_DATABASE_URL to a migrated disposable *_test PostgreSQL database.' : false }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.match(url.pathname, /_test$/u, 'Integration tests require a dedicated database ending in _test');
  assert.equal(process.env.AET_TEST_DISPOSABLE_DB, 'true', 'Explicit disposable-database confirmation is required');
  const prefix = randomUUID();
  const db = createPrismaClient(databaseUrl);
  const repository = await createPrismaRepository(databaseUrl);
  const origin = 'http://localhost:3000';
  const username = `test-${prefix}`;
  const password = randomBytes(24).toString('hex');
  const admin = await db.admin.create({ data: { username, passwordHash: await hashPassword(password) } });
  const app = await buildApp({ repository, env: { databaseUrl, sessionSecret: randomBytes(32).toString('hex'), appOrigins: [origin], production: false, port: 4000, cookieSameSite: 'lax' } });
  const created: { news?: string; events?: string; team?: string } = {};
  try {
    assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: { username, password } });
    assert.equal(login.statusCode, 200, login.body);
    const cookie = login.cookies[0].name + '=' + encodeURIComponent(login.cookies[0].value);
    const headers = { origin, cookie };
    const payloads = {
      news: { title: `Test ${prefix}`, slug: `test-${prefix}`, content: 'Konten PostgreSQL terisolasi.', published: true },
      events: { title: `Test ${prefix}`, description: 'Waktu asli dipertahankan.', startDate: '2026-01-20T08:00:00+07:00', endDate: '2026-01-20T16:00:00+07:00', published: true },
      team: { name: `Test ${prefix}`, position: 'Uji integrasi', order: 17, socials: { website: 'https://pcr.ac.id' } },
    };
    for (const resource of ['news', 'events', 'team'] as const) {
      const response = await app.inject({ method: 'POST', url: `/v1/admin/${resource}`, headers, payload: payloads[resource] });
      assert.equal(response.statusCode, 201, response.body);
      created[resource] = response.json().id;
      assert.ok(created[resource]);
    }
    const event = await db.event.findUniqueOrThrow({ where: { id: created.events } });
    assert.equal(event.startDate.toISOString(), '2026-01-20T01:00:00.000Z');
    const team = await db.teamMember.findUniqueOrThrow({ where: { id: created.team } });
    assert.deepEqual(team.socials, { website: 'https://pcr.ac.id' });
    assert.equal((await app.inject({ url: `/v1/news/test-${prefix}` })).statusCode, 200);
    assert.equal((await app.inject({ url: `/v1/events/${created.events}` })).statusCode, 200);
    const unpublished = await app.inject({ method: 'PATCH', url: `/v1/admin/news/${created.news}`, headers, payload: { published: false } });
    assert.equal(unpublished.statusCode, 200, unpublished.body);
    assert.equal((await app.inject({ url: `/v1/news/test-${prefix}` })).statusCode, 404);
    assert.equal((await app.inject({ method: 'PATCH', url: `/v1/admin/team/${created.team}`, headers, payload: { socials: null, order: 2 } })).statusCode, 200);
    assert.equal((await db.teamMember.findUniqueOrThrow({ where: { id: created.team } })).socials, null);
    for (const resource of ['news', 'events', 'team'] as const) {
      assert.equal((await app.inject({ method: 'DELETE', url: `/v1/admin/${resource}/${created[resource]}`, headers })).statusCode, 200);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers, payload: {} })).statusCode, 200);
    assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie } })).statusCode, 401);
  } finally {
    // Cleanup only records owned by this run; never truncate tables or touch imported content.
    await db.news.deleteMany({ where: { id: created.news ?? '__no_record__' } });
    await db.event.deleteMany({ where: { id: created.events ?? '__no_record__' } });
    await db.teamMember.deleteMany({ where: { id: created.team ?? '__no_record__' } });
    await db.admin.delete({ where: { id: admin.id } });
    await app.close();
    await db.$disconnect();
  }
});
