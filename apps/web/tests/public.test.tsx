import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle'] as const) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const { createElement } = await import('react');
mock.module('next/image', { exports: { default: function MockImage({ unoptimized: _unoptimized, priority: _priority, fill: _fill, ...props }: Record<string, unknown>) { return createElement('img', props); } } });
mock.module('next/link', { exports: { default: function MockLink({ prefetch: _prefetch, ...props }: Record<string, unknown>) { return createElement('a', props); } } });
mock.module('next/navigation', { exports: { usePathname: () => '/' } });
const { render, fireEvent, cleanup } = await import('@testing-library/react');
const { default: Landing } = await import('../components/Landing');
const { NewsCollection } = await import('../components/PublicCollections');
const { default: PublicDetail } = await import('../components/PublicDetail');
const { safeImageUrl } = await import('../components/SafeImage');
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });

test('landing navigation preserves public destinations and all three persona choices open the requested mode', () => {
  const choices: string[] = [];
  const view = render(createElement(Landing, { onSelectPersona: value => choices.push(value) }));
  for (const [label, id] of [['Smart Companion', 'daily'], ['Academic Writer', 'report'], ['Coding Expert', 'coding']]) {
    fireEvent.click(view.getByRole('button', { name: new RegExp(label) }));
    assert.equal(choices.at(-1), id);
  }
  assert.ok(view.getByRole('heading', { name: /Intelligence for every idea/ }));
  assert.ok(view.getAllByRole('link', { name: 'Berita' }).some(link => link.getAttribute('href') === '/news/'));
  const doc = view.getByRole('link', { name: /Dokumen AET PCR/ });
  assert.equal(doc.getAttribute('href'), '/AETPCR.docx');
});

test('mobile menu opens an accessible native dialog and restores focus when closed', () => {
  const view = render(createElement(Landing, { onSelectPersona() {} }));
  const trigger = view.getByRole('button', { name: 'Buka navigasi' });
  fireEvent.click(trigger);
  const dialog = view.getByRole('dialog', { name: 'Jelajahi AET' });
  assert.equal(dialog.hasAttribute('open'), true);
  const lastLink = dialog.querySelectorAll('a')[4];
  lastLink.focus();
  fireEvent.keyDown(lastLink, { key: 'Tab' });
  assert.equal(dom.window.document.activeElement, view.getByRole('button', { name: 'Tutup navigasi' }));
  fireEvent.keyDown(view.getByRole('button', { name: 'Tutup navigasi' }), { key: 'Tab', shiftKey: true });
  assert.equal(dom.window.document.activeElement, lastLink);
  fireEvent.click(view.getByRole('button', { name: 'Tutup navigasi' }));
  assert.equal(dialog.hasAttribute('open'), false);
  assert.equal(dom.window.document.activeElement, trigger);
});

test('public collections show their real empty state rather than fabricated content', async () => {
  globalThis.fetch = async () => Response.json([]);
  const view = render(createElement(NewsCollection));
  assert.ok(await view.findByRole('heading', { name: 'Cerita baru sedang disiapkan' }));
  assert.ok(view.getByText('0 artikel dipublikasikan'));
});

test('stale exported detail shells never reveal content after the public API rejects a record', async () => {
  globalThis.fetch = async () => Response.json({ error: { code: 'NOT_FOUND', message: 'Tidak ditemukan' } }, { status: 404 });
  const view = render(createElement(PublicDetail, { kind: 'news', routeKey: 'unpublished-record' }));
  assert.ok(await view.findByRole('heading', { name: 'Konten tidak tersedia' }));
  assert.equal(view.queryByRole('article'), null);
});

test('malformed API collection responses produce an error state without crashing the page', async () => {
  globalThis.fetch = async () => Response.json({ unexpected: 'not an article list' });
  const view = render(createElement(NewsCollection));
  assert.ok(await view.findByRole('alert'));
  assert.equal(view.queryByText('0 artikel dipublikasikan'), null);
});

test('an unpublished record is withheld even when a misconfigured API returns HTTP 200', async () => {
  globalThis.fetch = async () => Response.json({ id: 'private-test', title: 'Draf privat', slug: 'private-test', content: 'Konten privat uji', summary: null, imageUrl: null, published: false, createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z' });
  const view = render(createElement(PublicDetail, { kind: 'news', routeKey: 'private-test' }));
  assert.ok(await view.findByRole('heading', { name: 'Konten tidak tersedia' }));
  assert.equal(view.queryByText('Draf privat'), null);
  assert.equal(view.queryByText('Konten privat uji'), null);
});

test('public image URLs reject executable schemes and credential-bearing destinations', () => {
  assert.equal(safeImageUrl('javascript:alert(1)'), null);
  assert.equal(safeImageUrl('https://secret@example.com/image.png'), null);
  assert.equal(safeImageUrl('//example.com/image.png'), null);
  assert.equal(safeImageUrl('/favicon.png'), '/favicon.png');
  assert.equal(safeImageUrl('https://example.com/image.png'), 'https://example.com/image.png');
});
