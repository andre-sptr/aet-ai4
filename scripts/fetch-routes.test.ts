import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPublicCollection } from './fetch-routes.js';

test('route synchronization recovers from a short network restart and 503', async () => {
  let attempts = 0;
  const result = await readPublicCollection('http://localhost:4000', '/v1/news', {
    fetcher: (async () => {
      attempts++;
      if (attempts === 1) throw new TypeError('fetch failed');
      if (attempts === 2) return new Response('temporarily unavailable', { status: 503 });
      return Response.json([{ slug: 'published-news' }]);
    }) as typeof fetch,
    wait: async () => {},
  });
  assert.equal(attempts, 3);
  assert.deepEqual(result, [{ slug: 'published-news' }]);
});

test('route synchronization never retries 4xx or invalid JSON', async () => {
  for (const response of [new Response('not found', { status: 404 }), new Response('not JSON')]) {
    let attempts = 0;
    await assert.rejects(readPublicCollection('http://localhost:4000', '/v1/news', {
      fetcher: (async () => { attempts++; return response; }) as typeof fetch,
      wait: async () => {},
    }));
    assert.equal(attempts, 1);
  }
});

test('route synchronization remains bounded and fails instead of inventing data', async () => {
  let attempts = 0;
  await assert.rejects(readPublicCollection('http://localhost:4000', '/v1/events', {
    fetcher: (async () => { attempts++; return new Response('unavailable', { status: 500 }); }) as typeof fetch,
    wait: async () => {},
  }), /HTTP 500/);
  assert.equal(attempts, 4);
});
