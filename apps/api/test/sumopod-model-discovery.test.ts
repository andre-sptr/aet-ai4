import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSumopodModelIds, SUMOPOD_MODELS_ENDPOINT } from '../src/ai/models/sumopod-discovery.js';

test('Sumopod model discovery requests authenticated OpenAI-compatible model list', async () => {
  let requestedUrl = '';
  let authorization = '';
  const result = await fetchSumopodModelIds({
    apiKey: 'test-key',
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ object: 'list', data: [{ id: 'gpt-5-mini' }, { id: 'claude-haiku-4-5' }, { id: 'gpt-5-mini' }, { id: '../invalid' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(requestedUrl, SUMOPOD_MODELS_ENDPOINT);
  assert.equal(authorization, 'Bearer test-key');
  assert.deepEqual(result.ids, ['claude-haiku-4-5', 'gpt-5-mini']);
});

test('Sumopod model discovery rejects missing credentials', async () => {
  await assert.rejects(() => fetchSumopodModelIds({ apiKey: '' }), (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === 'PROVIDER_UNCONFIGURED');
});

test('Sumopod model discovery rejects malformed payloads', async () => {
  await assert.rejects(() => fetchSumopodModelIds({
    apiKey: 'test-key',
    fetcher: async () => new Response(JSON.stringify({ data: 'not-an-array' }), { status: 200 }),
  }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'MODEL_DISCOVERY_FORMAT');
});
