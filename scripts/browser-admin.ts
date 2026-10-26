import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';
import sharp from 'sharp';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/auth.js';
import { createPrismaClient } from '../apps/api/src/db.js';
import { readBackendEnv } from '../apps/api/src/env.js';
import { AiError } from '../apps/api/src/ai/errors.js';
import type { AiProvider } from '../apps/api/src/ai/provider.js';

/** Actual exported UI + HTTP API + isolated PostgreSQL; all provider/storage calls are fixtures. */
async function run() {
  const databaseUrl = process.env.AET_TEST_DATABASE_URL;
  if (!databaseUrl || process.env.AET_TEST_DISPOSABLE_DB !== 'true') throw new Error('Set AET_TEST_DATABASE_URL and AET_TEST_DISPOSABLE_DB=true for a disposable local database.');
  const database = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['localhost', '127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_test')) throw new Error('Browser integration only accepts a local PostgreSQL database whose name ends in _test.');
  const origin = process.env.AET_BROWSER_ORIGIN ?? 'http://localhost:3000';
  const frontend = new URL(origin);
  if (frontend.origin !== origin || frontend.protocol !== 'http:' || frontend.hostname !== 'localhost') throw new Error('Serve the static frontend at an explicit HTTP localhost origin.');
  const apiPort = Number(process.env.AET_BROWSER_API_PORT ?? 4001);
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535 || apiPort === 4000) throw new Error('Use a separate valid API test port, not the development API port 4000.');
  const testApi = `http://localhost:${apiPort}`;
  const browserApi = 'http://localhost:4000';
  const suffix = randomBytes(6).toString('hex');
  const username = `browser-${suffix}`;
  const password = randomBytes(30).toString('base64url');
  const sessionSecret = randomBytes(48).toString('hex');
  const db = createPrismaClient(databaseUrl);
  const owned = { news: new Set<string>(), events: new Set<string>(), team: new Set<string>() };
  const checks: string[] = [];
  let stage = 'prepare';
  let adminId: string | undefined;
  let providerCalls = 0;
  let uploadCalls = 0;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let page: Page | undefined;
  const directory = '.local/browser';
  const fixtureResponse = 'Respons model tiruan untuk pengujian antarmuka.';
  const provider: AiProvider = {
    async *stream(request) { request.signal.throwIfAborted(); providerCalls += 1; yield fixtureResponse; },
    async complete(request) {
      request.signal.throwIfAborted(); providerCalls += 1;
      if (request.model.id === 'operator/fail-fixture') throw new AiError('PROVIDER_REJECTED', 'Kesalahan model tiruan.', 502);
      return fixtureResponse;
    },
  };
  const safeMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replaceAll(password, '[redacted]').replaceAll(username, '[redacted]').replaceAll(sessionSecret, '[redacted]');
  try {
    await mkdir(directory, { recursive: true });
    const admin = await db.admin.create({ data: { username, passwordHash: await hashPassword(password) } });
    adminId = admin.id;
    app = await buildApp({
      env: readBackendEnv({ DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret, APP_ORIGIN: origin, PORT: String(apiPort), NODE_ENV: 'test' }),
      aiProvider: provider,
      storage: { async put() { uploadCalls += 1; return `${origin}/favicon.png`; } },
    });
    await app.listen({ host: '127.0.0.1', port: apiPort });
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === browserApi) {
        url.port = String(apiPort);
        const response = await route.fetch({ url: url.href });
        await route.fulfill({ response });
      } else if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') await route.continue();
      else await route.abort('blockedbyclient');
    });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(safeMessage(error)));

    stage = 'unauthenticated guard';
    await page.goto(`${origin}/admin/`);
    await page.waitForURL(`${origin}/login/`);
    await page.getByRole('heading', { name: 'Masuk ke workspace.', exact: true }).waitFor();
    const denied = await fetch(`${testApi}/v1/admin/news`);
    assert.equal(denied.status, 401);
    const originDenied = await fetch(`${testApi}/v1/news`, { headers: { Origin: 'http://untrusted.invalid' } });
    assert.equal(originDenied.status, 403);
    checks.push('Static admin guard and backend authorization/CORS reject unauthorized access');

    stage = 'browser login and cookie';
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/auth/login' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Masuk dashboard' }).click();
    const login = await loginResponse;
    assert.equal(login.status(), 200);
    assert.equal(login.headers()['access-control-allow-origin'], origin);
    assert.equal(login.headers()['access-control-allow-credentials'], 'true');
    await page.waitForURL(`${origin}/admin/`);
    await page.getByRole('heading', { name: 'Selamat datang kembali.', exact: true }).waitFor();
    const cookie = (await context.cookies(browserApi)).find(item => item.name === 'aet_session');
    assert.ok(cookie?.httpOnly);
    assert.equal(cookie.sameSite, 'Lax');
    assert.equal(cookie.secure, false); // This fixture uses HTTP; production requires Secure.
    assert.equal(providerCalls, 0);
    checks.push('Real browser login establishes HttpOnly session and loads dashboard through allowed-origin CORS');

    async function write<T>(method: string, path: string, action: () => Promise<void>, expected = 200): Promise<T> {
      const response = page!.waitForResponse(item => new URL(item.url()).pathname === path && item.request().method() === method);
      await action();
      const result = await response;
      assert.equal(result.status(), expected, `${method} ${path} returned an unexpected status`);
      return result.json() as Promise<T>;
    }
    async function saveRecord(kind: keyof typeof owned, method: 'POST' | 'PATCH', id?: string) {
      const path = `/v1/admin/${kind}${id ? `/${id}` : ''}`;
      const value = await write<{ id: string }>(method, path, () => page!.getByRole('button', { name: 'Simpan perubahan', exact: true }).click(), method === 'POST' ? 201 : 200);
      if (method === 'POST') owned[kind].add(value.id);
      await page!.getByRole('dialog').waitFor({ state: 'hidden' });
      return value.id;
    }
    async function removeRecord(kind: keyof typeof owned, id: string, title: string) {
      await page!.getByRole('button', { name: `Hapus ${title}`, exact: true }).click();
      await page!.getByRole('heading', { name: new RegExp(`^Hapus ${kind === 'news' ? 'berita' : kind === 'events' ? 'kegiatan' : 'anggota'}\\?$`) }).waitFor();
      await write('DELETE', `/v1/admin/${kind}/${id}`, () => page!.getByRole('button', { name: 'Ya, hapus', exact: true }).click());
      await page!.getByRole('dialog').waitFor({ state: 'hidden' });
      await page!.getByRole('button', { name: `Edit ${title}`, exact: true }).waitFor({ state: 'hidden' });
    }

    stage = 'news CRUD and publication';
    const newsTitle = `Berita pengujian UI ${suffix}`;
    const newsEdited = `${newsTitle} diperbarui`;
    const slug = `browser-news-${suffix}`;
    const slugEdited = `${slug}-updated`;
    await page.goto(`${origin}/admin/news/`);
    await page.getByRole('button', { name: 'Tambah berita', exact: true }).click();
    await page.getByLabel('Judul berita', { exact: true }).fill(newsTitle);
    await page.getByLabel('Slug / URL', { exact: true }).fill(slug);
    await page.getByLabel('Ringkasan', { exact: true }).fill('Ringkasan fixture browser, bukan konten produksi.');
    await page.getByLabel('Konten artikel', { exact: true }).fill('## Artikel pengujian\n\nKonten **Markdown** fixture browser.');
    const newsId = await saveRecord('news', 'POST');
    assert.equal((await fetch(`${testApi}/v1/news/${slug}`)).status, 404);
    await page.getByRole('button', { name: `Edit ${newsTitle}`, exact: true }).click();
    await page.getByLabel('Judul berita', { exact: true }).fill(newsEdited);
    await page.getByLabel('Slug / URL', { exact: true }).fill(slugEdited);
    await page.getByRole('checkbox', { name: /Published/ }).check();
    await saveRecord('news', 'PATCH', newsId);
    assert.equal((await fetch(`${testApi}/v1/news/${slug}`)).status, 404);
    assert.equal((await fetch(`${testApi}/v1/news/${slugEdited}`)).status, 200);
    await write('PATCH', `/v1/admin/news/${newsId}`, () => page!.locator('.admin-content-list > li').filter({ has: page!.getByRole('heading', { name: newsEdited, exact: true }) }).getByRole('button', { name: 'Jadikan draf', exact: true }).click());
    assert.equal((await fetch(`${testApi}/v1/news/${slugEdited}`)).status, 404);
    await write('PATCH', `/v1/admin/news/${newsId}`, () => page!.locator('.admin-content-list > li').filter({ has: page!.getByRole('heading', { name: newsEdited, exact: true }) }).getByRole('button', { name: 'Publikasikan', exact: true }).click());
    assert.equal((await fetch(`${testApi}/v1/news/${slugEdited}`)).status, 200);
    await page.getByRole('button', { name: `Hapus ${newsEdited}`, exact: true }).click();
    await page.getByRole('button', { name: 'Batal', exact: true }).click();
    assert.ok(await db.news.findUnique({ where: { id: newsId } }));
    await removeRecord('news', newsId, newsEdited);
    assert.equal(await db.news.findUnique({ where: { id: newsId } }), null);
    checks.push('News create/edit/slug/publication/unpublication/delete and delete-cancel work through UI and PostgreSQL');

    stage = 'events CRUD and WIB';
    const eventTitle = `Kegiatan pengujian UI ${suffix}`;
    await page.goto(`${origin}/admin/events/`);
    await page.getByRole('button', { name: 'Tambah kegiatan', exact: true }).click();
    await page.getByLabel('Nama kegiatan', { exact: true }).fill(eventTitle);
    await page.getByLabel('Lokasi', { exact: true }).fill('Lokasi fixture browser');
    await page.getByLabel('Waktu mulai (WIB)', { exact: true }).fill('2026-11-15T09:30');
    await page.getByLabel('Waktu selesai (WIB, opsional)', { exact: true }).fill('2026-11-15T11:00');
    await page.getByLabel('Deskripsi kegiatan', { exact: true }).fill('Kegiatan fixture browser, bukan agenda produksi.');
    await page.getByRole('checkbox', { name: /Published/ }).check();
    const eventId = await saveRecord('events', 'POST');
    const storedEvent = await db.event.findUniqueOrThrow({ where: { id: eventId } });
    assert.equal(storedEvent.startDate.toISOString(), '2026-11-15T02:30:00.000Z');
    assert.equal(storedEvent.endDate?.toISOString(), '2026-11-15T04:00:00.000Z');
    assert.equal((await fetch(`${testApi}/v1/events/${eventId}`)).status, 200);
    await page.getByRole('button', { name: `Edit ${eventTitle}`, exact: true }).click();
    assert.equal(await page.getByLabel('Waktu mulai (WIB)', { exact: true }).inputValue(), '2026-11-15T09:30');
    await page.getByLabel('Lokasi', { exact: true }).fill('Lokasi fixture diperbarui');
    await saveRecord('events', 'PATCH', eventId);
    assert.equal((await db.event.findUniqueOrThrow({ where: { id: eventId } })).location, 'Lokasi fixture diperbarui');
    await removeRecord('events', eventId, eventTitle);
    checks.push('Event create/edit/delete preserve stable ID routes and convert WIB input to UTC correctly');

    stage = 'team CRUD and validated image upload';
    const memberName = `Anggota pengujian UI ${suffix}`;
    await page.goto(`${origin}/admin/team/`);
    await page.getByRole('button', { name: 'Tambah anggota', exact: true }).click();
    await page.getByLabel('Nama lengkap', { exact: true }).fill(memberName);
    await page.getByLabel('Jabatan', { exact: true }).fill('Penguji fixture');
    await page.getByLabel('Urutan tampilan', { exact: true }).fill('7');
    await page.getByLabel('Bio singkat', { exact: true }).fill('Profil fixture browser, bukan anggota organisasi.');
    await page.getByLabel('Tautan sosial (JSON)', { exact: true }).fill('{"website":"https://example.com/browser-test"}');
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#2563eb' } }).png().toBuffer();
    await write('POST', '/v1/uploads', () => page!.getByLabel('Unggah gambar', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: image }));
    await page.waitForFunction(value => (document.querySelector('input[type="url"]') as HTMLInputElement | null)?.value === value, `${origin}/favicon.png`);
    await page.getByAltText('Pratinjau foto anggota', { exact: true }).waitFor();
    await page.waitForFunction(() => { const image = document.querySelector('img.admin-image-preview') as HTMLImageElement | null; return Boolean(image?.complete && image.naturalWidth > 0); });
    assert.equal(uploadCalls, 1);
    const memberId = await saveRecord('team', 'POST');
    const member = await db.teamMember.findUniqueOrThrow({ where: { id: memberId } });
    assert.equal(member.order, 7);
    assert.deepEqual(member.socials, { website: 'https://example.com/browser-test' });
    assert.equal(member.photoUrl, `${origin}/favicon.png`);
    await page.getByRole('button', { name: `Edit ${memberName}`, exact: true }).click();
    await page.getByLabel('Urutan tampilan', { exact: true }).fill('3');
    await page.getByLabel('Jabatan', { exact: true }).fill('Penguji fixture diperbarui');
    await saveRecord('team', 'PATCH', memberId);
    assert.equal((await db.teamMember.findUniqueOrThrow({ where: { id: memberId } })).order, 3);
    await removeRecord('team', memberId, memberName);
    checks.push('Team create/edit/order/socials/delete and decoded image upload work with fixture storage adapter');

    stage = 'manual mocked model test';
    await page.goto(`${origin}/admin/ai/`);
    assert.equal(providerCalls, 0);
    await page.getByLabel('Model ID', { exact: true }).fill('operator/browser-fixture');
    await page.getByLabel('Prompt singkat', { exact: true }).fill('Prompt fixture browser.');
    assert.equal(providerCalls, 0);
    await write('POST', '/v1/admin/ai/model-test', () => page!.getByRole('button', { name: 'Test', exact: true }).click());
    await page.getByText(fixtureResponse, { exact: true }).waitFor();
    assert.equal(providerCalls, 1);
    await page.getByLabel('Model ID', { exact: true }).fill('operator/fail-fixture');
    await write('POST', '/v1/admin/ai/model-test', () => page!.getByRole('button', { name: 'Test', exact: true }).click(), 502);
    await page.getByRole('alert').filter({ hasText: 'Kesalahan model tiruan.' }).waitFor();
    assert.equal(providerCalls, 2);
    checks.push('Manual model panel sends no automatic requests and displays explicit fixture response/error');

    stage = 'desktop and mobile layout';
    await page.goto(`${origin}/admin/`);
    await page.getByRole('heading', { name: 'Selamat datang kembali.', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${directory}/admin-desktop.png`, fullPage: true, maskColor: '#ffffff', mask: [page.locator('.admin-topbar')] });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Buka menu admin', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('link', { name: 'Struktur tim', exact: true }).click();
    await page.waitForURL(`${origin}/admin/team/`);
    await page.getByRole('heading', { name: 'Tim & struktur', exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${directory}/admin-mobile.png`, fullPage: true, maskColor: '#ffffff', mask: [page.locator('.admin-topbar')] });
    checks.push('Desktop/mobile admin layouts have no horizontal overflow and native mobile dialog navigation works');

    stage = 'logout';
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Keluar dari admin', exact: true }).click();
    await page.waitForURL(`${origin}/login/`);
    const sessionStatus = await page.evaluate(async api => (await fetch(`${api}/v1/auth/me`, { credentials: 'include' })).status, browserApi);
    assert.equal(sessionStatus, 401);
    assert.equal((await context.cookies(browserApi)).some(item => item.name === 'aet_session'), false);
    assert.deepEqual(pageErrors, []);
    checks.push('Logout clears session cookie, revokes API access, and no uncaught browser errors occurred');
    await writeFile(`${directory}/admin-results.json`, JSON.stringify({ passed: checks.length, checks, mockedProviderCalls: providerCalls, fixtureStorageCalls: uploadCalls, liveProviderCalls: 0, database: 'disposable local _test database', screenshots: ['admin-desktop.png', 'admin-mobile.png'] }, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: `${directory}/admin-failure.png`, fullPage: true, maskColor: '#ffffff', mask: [page.locator('input'), page.locator('textarea'), page.locator('.admin-topbar')] }).catch(() => undefined);
    await writeFile(`${directory}/admin-results.json`, JSON.stringify({ failedStage: stage, error: safeMessage(error), passed: checks.length, checks, liveProviderCalls: 0 }, null, 2)).catch(() => undefined);
    throw new Error(`Browser admin integration failed at ${stage}: ${safeMessage(error)}`);
  } finally {
    await browser?.close();
    await app?.close();
    for (const id of owned.news) await db.news.deleteMany({ where: { id } });
    for (const id of owned.events) await db.event.deleteMany({ where: { id } });
    for (const id of owned.team) await db.teamMember.deleteMany({ where: { id } });
    if (adminId) {
      await db.session.deleteMany({ where: { adminId } });
      await db.admin.deleteMany({ where: { id: adminId } });
    }
    await db.$disconnect();
  }
  console.log(`PASS browser-admin: ${checks.length} workflow checks; PostgreSQL fixtures cleaned; 0 live provider calls.`);
}

await run().catch(error => { console.error(error instanceof Error ? error.message : 'Browser admin integration failed.'); process.exitCode = 1; });
