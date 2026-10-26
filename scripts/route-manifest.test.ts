import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadManifest, manifestFromPublicRows, saveManifest, validateManifest } from './route-manifest.js';

test('static route keys preserve published legacy URLs without embedding content', () => {
  const manifest = manifestFromPublicRows([{ slug: 'known--legacy-slug', content: 'private text is excluded' }], [{ id: 'event-123', description: 'excluded too' }]);
  assert.deepEqual(manifest, { news: [{ slug: 'known--legacy-slug' }], events: [{ id: 'event-123' }] });
  assert.equal(JSON.stringify(manifest).includes('private text'), false);
});

test('route validation rejects traversal, duplicates, and embedded content', () => {
  assert.throws(() => manifestFromPublicRows([{ slug: '../private' }], []), /Invalid/);
  assert.throws(() => manifestFromPublicRows([], [{ id: 'x/y' }]), /Invalid/);
  assert.throws(() => manifestFromPublicRows([{ slug: 'same' }, { slug: 'same' }], []), /duplicate/);
  assert.throws(() => validateManifest({ news: [{ slug: 'valid', content: 'do not export' }], events: [] }), /only/);
  assert.throws(() => validateManifest({ news: [], events: [], body: 'private' }), /only/);
});

test('route manifests save atomically, reload deterministically, and fail actionably when missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aet-routes-'));
  try {
    const file = join(directory, 'routes.json');
    await saveManifest({ news: [{ slug: 'z' }, { slug: 'a' }], events: [] }, file);
    assert.deepEqual(await loadManifest(file), { news: [{ slug: 'a' }, { slug: 'z' }], events: [] });
    assert.ok((await readFile(file, 'utf8')).endsWith('\n'));
    await assert.rejects(loadManifest(join(directory, 'missing.json')), /sync:routes/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
