import test from 'node:test';
import assert from 'node:assert/strict';
import { createSumopodProvider, readProviderSse, type ProviderRequest } from '../src/ai/provider.js';
import { MODEL_CATALOG, SUMOPOD_ENDPOINT } from '../src/ai/models.js';

function byteStream(chunks: string[]) { return new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach(chunk => controller.enqueue(new TextEncoder().encode(chunk))); controller.close(); } }); }
const request: ProviderRequest = { model: MODEL_CATALOG[0]!, messages: [{ role: 'user', content: 'test' }], signal: new AbortController().signal, maxTokens: 100, effort: 'normal' };

test('provider SSE parses split frames and refuses truncated or rejected output', async () => {
  assert.deepEqual(await Array.fromAsync(readProviderSse(byteStream(['data: {"choices":[{"delta":{"content":"He', 'llo"},"finish_reason":null}]}\r\n\r\n', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n']), request.signal)), ['Hello']);
  await assert.rejects(Array.fromAsync(readProviderSse(byteStream(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']), request.signal)), /terputus/);
  await assert.rejects(Array.fromAsync(readProviderSse(byteStream(['data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n']), request.signal)), /belum selesai/);
  await assert.rejects(Array.fromAsync(readProviderSse(byteStream(['data: null\n\n']), request.signal)), /tidak valid/);
});
test('adapter uses fixed endpoint and server key; capability-specific extensions stay absent', async () => {
  let received: Record<string, unknown> = {};
  const provider = createSumopodProvider({ apiKey: 'synthetic-key-not-a-secret', fetcher: async (url, init) => {
    assert.equal(url, SUMOPOD_ENDPOINT);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-key-not-a-secret');
    received = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.equal(await provider.complete(request), 'ok');
  for (const field of ['reasoning_effort', 'tools', 'tool_choice', 'response_format']) assert.equal(field in received, false);
  await provider.complete({ ...request, model: MODEL_CATALOG[2]! });
  assert.equal('max_tokens' in received, false);
  assert.equal(received.max_completion_tokens, 100);
});
test('provider errors expose safe status meaning without echoing private provider response', async () => {
  const provider = createSumopodProvider({ apiKey: 'synthetic-key-not-a-secret', fetcher: async () => new Response('secret raw provider internal content', { status: 404 }) });
  await assert.rejects(provider.complete(request), error => error instanceof Error && /Model tidak tersedia/.test(error.message) && !error.message.includes('secret'));
});

test('provider completion enforces byte cap during reading and rejects malformed JSON objects', async () => {
  let cancelled = false;
  const enormous = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(128_001)); },
    cancel() { cancelled = true; },
  });
  const provider = createSumopodProvider({ apiKey: 'fixture', fetcher: async () => new Response(enormous) });
  await assert.rejects(provider.complete(request), /batas ukuran/); assert.equal(cancelled, true);
  for (const raw of ['null', '[]', '{"choices":[]}', '{"choices":[{"message":{"content":"unfinished"}}]}']) {
    const malformed = createSumopodProvider({ apiKey: 'fixture', fetcher: async () => new Response(raw) });
    await assert.rejects(malformed.complete(request));
  }
});
