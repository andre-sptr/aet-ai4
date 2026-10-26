import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.AET_BROWSER_ORIGIN || 'http://localhost:3000';
const artifacts = path.join(root, '.local', 'browser');
await mkdir(artifacts, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(root, 'data', 'routes.json'), 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
const errors = [];
const consoleErrors = [];
const requests = [];
const record = name => results.push({ name, passed: true });

function observe(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ message: message.text(), url: message.location().url }); });
}

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  observe(page);
  // Mock only the AI provider boundary. All public content is read from the real local API.
  await page.route('**/v1/chat', async route => {
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    const request = route.request().postDataJSON();
    requests.push(request);
    if (request.messages.at(-1)?.content.includes('TUNDA_UJI')) {
      await new Promise(resolve => setTimeout(resolve, 900));
      await route.fulfill({ status: 200, headers, contentType: 'text/event-stream', body: 'event: delta\ndata: {"text":"Jawaban tertunda"}\n\nevent: done\ndata: {"requestId":"browser-cancelled","status":"complete"}\n\n' }).catch(() => {});
      return;
    }
    await route.fulfill({ status: 200, headers, contentType: 'text/event-stream', body: 'event: status\ndata: {"message":"Menganalisis permintaan"}\n\nevent: metadata\ndata: {"model":"mock-browser","strategy":"direct"}\n\nevent: delta\ndata: {"text":"Jawaban uji **selesai**.\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |"}\n\nevent: done\ndata: {"requestId":"browser-mock","status":"complete"}\n\n' });
  });

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Intelligence for every idea/ }).waitFor();
  await noOverflow(page, 'desktop landing');
  await page.screenshot({ path: path.join(artifacts, 'desktop-home.png'), fullPage: true });
  assert.equal(await page.locator('#pilih-mode .mode-card').count(), 3);
  record('desktop landing, original content, all three persona cards, no horizontal overflow');

  for (const [route, heading] of [['/news/', /Cerita, wawasan/], ['/events/', /Terhubung lewat/], ['/team/', /Bergerak bersama/], ['/login/', /Selamat datang|Masuk|admin/i]]) {
    await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: heading }).first().waitFor();
    if (route !== '/login/') await page.locator('.collection-toolbar').waitFor();
    await noOverflow(page, `desktop ${route}`);
    record(`desktop static route ${route}`);
  }
  for (const item of manifest.news) {
    await page.goto(`${origin}/news/${encodeURIComponent(item.slug)}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('article .article-header h1').waitFor();
    await page.locator('article .rich-content').waitFor();
    record('published news detail shell loads current API record and Markdown');
  }
  for (const item of manifest.events) {
    await page.goto(`${origin}/events/${encodeURIComponent(item.id)}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('article .article-header h1').waitFor();
    await page.getByText(/WIB/).first().waitFor();
    record('event detail preserves ID URL and Asia/Jakarta display');
  }

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Smart Companion/ }).click();
  const input = page.getByRole('textbox', { name: 'Pesan untuk Smart Companion' });
  await input.waitFor();
  await page.getByRole('radio', { name: 'Think' }).check();
  await input.fill('Permintaan browser uji untuk riwayat');
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
  await page.getByRole('article', { name: 'Jawaban AET AI' }).getByText('Jawaban uji').waitFor();
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).waitFor();
  assert.equal(requests[0].persona, 'daily');
  assert.equal(requests[0].effort, 'think');
  assert.equal('modelId' in requests[0], false);
  record('chat persona/Think selection reaches backend DTO and completes mocked typed SSE');

  await page.getByRole('button', { name: 'Ganti nama percakapan', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Ganti nama percakapan' });
  await rename.getByLabel('Nama percakapan').fill('Percakapan uji browser');
  await rename.getByRole('button', { name: 'Simpan nama' }).click();
  await page.getByRole('button', { name: 'Buka riwayat' }).click();
  const history = page.getByRole('dialog', { name: 'Percakapan tersimpan' });
  await history.getByRole('textbox', { name: 'Cari percakapan tersimpan' }).fill('uji browser');
  await history.getByRole('button', { name: 'Percakapan uji browser', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Buka riwayat' }).evaluate(element => element === document.activeElement), true);
  record('history rename/search and keyboard dialog close restore focus');

  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await input.fill('Permintaan browser setelah edit');
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).waitFor();
  assert.equal(requests.at(-1).messages.length, 1);
  record('editing an earlier user message truncates later context before regeneration');

  await input.fill('TUNDA_UJI');
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
  await page.getByRole('button', { name: 'Hentikan jawaban' }).click();
  await page.getByRole('alert').filter({ hasText: 'Permintaan dihentikan' }).waitFor();
  await page.getByText('Jawaban belum selesai.', { exact: false }).last().waitFor();
  record('cancellation marks response incomplete and offers retry');
  await page.getByRole('button', { name: 'Hapus percakapan', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Hapus percakapan ini?' });
  await remove.getByRole('button', { name: 'Hapus percakapan', exact: true }).click();
  await page.getByRole('heading', { name: 'Apa yang ingin kamu eksplorasi?' }).waitFor();
  record('conversation deletion requires confirmation and returns to clean state');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const phone = await mobile.newPage();
  observe(phone);
  await phone.goto(origin, { waitUntil: 'domcontentloaded' });
  await phone.getByRole('heading', { name: /Intelligence for every idea/ }).waitFor();
  await noOverflow(phone, 'mobile landing');
  await phone.screenshot({ path: path.join(artifacts, 'mobile-home.png'), fullPage: true });
  await phone.getByRole('button', { name: 'Buka navigasi' }).click();
  const nav = phone.getByRole('dialog', { name: 'Jelajahi AET' });
  await nav.waitFor();
  for (let index = 0; index < 9; index++) {
    await phone.keyboard.press('Tab');
    assert.equal(await nav.evaluate(element => element.contains(document.activeElement)), true);
  }
  await phone.keyboard.press('Escape');
  assert.equal(await phone.getByRole('button', { name: 'Buka navigasi' }).evaluate(element => element === document.activeElement), true);
  record('mobile navigation native dialog traps keyboard focus and Escape restores trigger');
  for (const [persona, heading] of [['Academic Writer', 'Tulisan yang kuat dimulai dari ide.'], ['Coding Expert', 'Mari bangun sesuatu yang bekerja.']]) {
    await phone.getByRole('button', { name: new RegExp(persona) }).click();
    await phone.getByRole('heading', { name: heading }).waitFor();
    await noOverflow(phone, `mobile ${persona}`);
    await phone.getByRole('button', { name: 'Kembali ke beranda' }).click();
  }
  record('mobile academic/coding workspaces and composer layout');
  assert.deepEqual(errors, [], 'Unexpected browser runtime errors');
  const applicationConsoleErrors = consoleErrors.filter(item => !item.url || item.url.startsWith(origin) || item.url.startsWith('http://localhost:4000'));
  assert.deepEqual(applicationConsoleErrors, [], 'Unexpected application console errors');
  await mobile.close();
  await context.close();
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ origin, checks: results.length, results, runtimeErrors: errors, applicationConsoleErrors, externalConsoleErrors: consoleErrors.filter(item => !applicationConsoleErrors.includes(item)), provider: 'mocked; no live request', at: new Date().toISOString() }, null, 2));
  console.log(`Browser smoke passed ${results.length} checks; screenshots/report in .local/browser.`);
} finally { await browser.close(); }
