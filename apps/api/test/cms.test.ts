import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/auth.js';
import type { BackendEnv } from '../src/env.js';
import { MemoryRepository } from './memory-repository.js';
import { RateLimiter } from '../src/rate-limit.js';
import { validateDecodedImage } from '../src/storage.js';

const origin = 'http://localhost:3000';
const password = 'disposable-test-password-32';
function testEnv(): BackendEnv {
  return { databaseUrl: 'postgresql://unused-test/unused', sessionSecret: randomBytes(32).toString('hex'), appOrigins: [origin], production: false, port: 4000, cookieSameSite: 'lax' };
}
async function fixture(run: (app: FastifyInstance, repository: MemoryRepository) => Promise<void>, options: { now?: () => number; production?: boolean } = {}) {
  const repository = new MemoryRepository();
  await repository.createAdmin('operator', await hashPassword(password));
  const env = testEnv();
  env.production = options.production ?? false;
  const app = await buildApp({ repository, env, now: options.now });
  try { await run(app, repository); } finally { await app.close(); }
}
async function login(app: FastifyInstance) {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: { username: 'operator', password } });
  assert.equal(response.statusCode, 200, response.body);
  return response.cookies[0].name + '=' + encodeURIComponent(response.cookies[0].value);
}
const news = { title: 'Berita AET', slug: 'berita--aet', content: '# Berita asli', summary: null, imageUrl: null, published: false };

test('password hashing uses salted scrypt and never accepts the wrong password', async () => {
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('incorrect', a), false);
  assert.equal(await verifyPassword(password, 'malformed'), false);
});

test('API enforces origin/CSRF and auth on every CMS write, while public reads need no cookie', async () => {
  await fixture(async app => {
    for (const resource of ['news', 'events', 'team']) {
      assert.equal((await app.inject({ method: 'POST', url: `/v1/admin/${resource}`, payload: {} })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: `/v1/admin/${resource}`, headers: { origin }, payload: {} })).statusCode, 401);
      assert.equal((await app.inject({ method: 'PATCH', url: `/v1/admin/${resource}/missing`, headers: { origin }, payload: {} })).statusCode, 401);
      assert.equal((await app.inject({ method: 'DELETE', url: `/v1/admin/${resource}/missing`, headers: { origin } })).statusCode, 401);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/v1/news' })).statusCode, 200);
    const denied = await app.inject({ method: 'GET', url: '/v1/news', headers: { origin: 'https://attacker.invalid' } });
    assert.equal(denied.statusCode, 403);
    const allowed = await app.inject({ method: 'GET', url: '/v1/news', headers: { origin } });
    assert.equal(allowed.headers['access-control-allow-origin'], origin);
    assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  });
});

test('signed sessions expire, reject forged cookies, logout revokes the server-side session', async () => {
  let time = Date.now();
  await fixture(async app => {
    const cookie = await login(app);
    assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie } })).json().user.username, 'operator');
    assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie: cookie + 'tampered' } })).statusCode, 401);
    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { origin, cookie }, payload: {} });
    assert.equal(logout.statusCode, 200);
    assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie } })).statusCode, 401);
    const secondCookie = await login(app);
    time += 86_400_001;
    assert.equal((await app.inject({ url: '/v1/auth/me', headers: { cookie: secondCookie } })).statusCode, 401);
  }, { now: () => time });
});

test('production cookie is Secure HttpOnly and host-scoped', async () => {
  await fixture(async app => {
    const response = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: { username: 'operator', password } });
    const header = String(response.headers['set-cookie']);
    assert.match(header, /__Host-aet_session=/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /Secure/);
    assert.match(header, /SameSite=Lax/);
    assert.doesNotMatch(header, /Domain=/);
  }, { production: true });
});

test('news CRUD preserves double-hyphen URLs and unpublished content remains inaccessible through stale routes', async () => {
  await fixture(async app => {
    const cookie = await login(app), headers = { origin, cookie };
    const created = await app.inject({ method: 'POST', url: '/v1/admin/news', headers, payload: { ...news, summary: 'Ringkasan dipertahankan', imageUrl: 'https://pcr.ac.id/aet.jpg' } });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id;
    assert.equal((await app.inject({ url: '/v1/news/berita--aet' })).statusCode, 404);
    assert.deepEqual((await app.inject({ url: '/v1/news' })).json(), []);
    assert.equal((await app.inject({ url: '/v1/admin/news', headers: { cookie } })).json().length, 1);
    const published = await app.inject({ method: 'PATCH', url: `/v1/admin/news/${id}`, headers, payload: { published: true } });
    assert.equal(published.statusCode, 200, published.body);
    assert.equal(published.json().summary, 'Ringkasan dipertahankan');
    assert.equal(published.json().imageUrl, 'https://pcr.ac.id/aet.jpg');
    assert.equal((await app.inject({ url: '/v1/news/berita--aet' })).json().content, news.content);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/admin/news', headers, payload: news })).statusCode, 409);
    assert.equal((await app.inject({ method: 'PATCH', url: `/v1/admin/news/${id}`, headers, payload: { published: false } })).statusCode, 200);
    assert.equal((await app.inject({ url: '/v1/news/berita--aet' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: `/v1/admin/news/${id}`, headers })).statusCode, 200);
    assert.deepEqual((await app.inject({ url: '/v1/admin/news', headers: { cookie } })).json(), []);
  });
});

test('CMS rejects mass assignment, unsafe URLs, invalid dates, and preserves team ordering', async () => {
  await fixture(async app => {
    const cookie = await login(app), headers = { origin, cookie };
    for (const payload of [{ ...news, admin: true }, { ...news, imageUrl: 'javascript:alert(1)' }, { ...news, slug: '../private' }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/v1/admin/news', headers, payload })).statusCode, 400);
    }
    const invalidEvent = { title: 'Kegiatan', description: 'AET', startDate: '2026-01-21T01:00:00+07:00', endDate: '2026-01-20T01:00:00+07:00' };
    assert.equal((await app.inject({ method: 'POST', url: '/v1/admin/events', headers, payload: invalidEvent })).statusCode, 400);
    const member = await app.inject({ method: 'POST', url: '/v1/admin/team', headers, payload: { name: 'Nama terverifikasi', position: 'Pengurus', order: 2, socials: { website: 'https://pcr.ac.id' } } });
    assert.equal(member.statusCode, 201, member.body);
    const id = member.json().id;
    assert.equal((await app.inject({ method: 'PATCH', url: `/v1/admin/team/${id}`, headers, payload: { order: 1 } })).json().order, 1);
  });
});

test('upload requires authorization, matching decoded image bytes, and configured persistent storage', async () => {
  await fixture(async app => {
    assert.equal((await app.inject({ method: 'POST', url: '/v1/uploads', headers: { origin, 'content-type': 'image/png' }, payload: Buffer.from('not an image') })).statusCode, 401);
    const cookie = await login(app);
    const response = await app.inject({ method: 'POST', url: '/v1/uploads', headers: { origin, cookie, 'content-type': 'image/png' }, payload: Buffer.from('not an image') });
    assert.equal(response.statusCode, 415, response.body);
    const sharp = (await import('sharp')).default;
    const validPng = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#0056d2' } }).png().toBuffer();
    assert.equal((await app.inject({ method: 'POST', url: '/v1/uploads', headers: { origin, cookie, 'content-type': 'image/png' }, payload: validPng })).statusCode, 503);
    await assert.rejects(validateDecodedImage(validPng, 'image/jpeg'), /tipe berkas/);
    await assert.rejects(validateDecodedImage(validPng.subarray(0, 30), 'image/png'), /rusak/);
  });
});

test('login has an IP abuse limit without relying on spoofed forwarding headers', async () => {
  await fixture(async app => {
    const urls = ['/v1/auth/login', '/v1/auth/%6cogin', '/v1/auth/lo%67in', '/v1/auth/login', '/v1/auth/login'];
    for (let i = 0; i < 5; i++) {
      const result = await app.inject({ method: 'POST', url: urls[i], headers: { origin, 'x-forwarded-for': `203.0.113.${i}` }, payload: { username: 'operator', password: 'wrong' } });
      assert.equal(result.statusCode, 401);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: { username: 'operator', password } })).statusCode, 429);
  });
});

test('rate-limit windows reset after elapsed time and never permit the extra request', () => {
  let time = 0;
  const limiter = new RateLimiter(() => time);
  limiter.take('user', 1, 1000);
  assert.throws(() => limiter.take('user', 1, 1000), /Terlalu banyak/);
  time = 1001;
  assert.doesNotThrow(() => limiter.take('user', 1, 1000));
});
