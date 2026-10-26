import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerAiRoutes } from '../src/ai/routes.js';
import type { AiProvider } from '../src/ai/provider.js';

const chat = { persona: 'daily', effort: 'normal', messages: [{ role: 'user', content: 'Halo' }] };
test('manual model panel is authenticated, explicit-only, flexible-ID and strictly validated', async () => {
  let calls = 0; const modelIds: string[] = [];
  const provider: AiProvider = { async *stream() { yield 'ok'; }, async complete(request) { calls++; modelIds.push(request.model.id); return 'Manual test answer'; } };
  const app = Fastify();
  await registerAiRoutes(app, { provider, requireAdmin: async (request, reply) => { if (request.headers.authorization !== 'synthetic-test-session') reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Login required' } }); } });
  try {
    await app.ready(); assert.equal(calls, 0);
    const denied = await app.inject({ method: 'POST', url: '/v1/admin/ai/model-test', payload: { modelId: 'operator-supported/model', prompt: 'Hi' } });
    assert.equal(denied.statusCode, 401); assert.equal(calls, 0);
    const invalid = await app.inject({ method: 'POST', url: '/v1/admin/ai/model-test', headers: { authorization: 'synthetic-test-session' }, payload: { modelId: 'operator-supported/model', prompt: 'Hi', apiKey: 'must-not-be-accepted' } });
    assert.equal(invalid.statusCode, 400); assert.equal(calls, 0);
    const response = await app.inject({ method: 'POST', url: '/v1/admin/ai/model-test', headers: { authorization: 'synthetic-test-session' }, payload: { modelId: 'operator-supported/model', prompt: 'Hi' } });
    assert.equal(response.statusCode, 200); assert.equal(calls, 1); assert.deepEqual(modelIds, ['operator-supported/model']);
    assert.equal(response.json().response, 'Manual test answer'); assert.equal(typeof response.json().elapsedMs, 'number');
  } finally { await app.close(); }
});
test('chat rejects arbitrary model and forged image bytes before provider execution', async () => {
  let calls = 0;
  const provider: AiProvider = { async *stream() { calls++; yield 'answer'; }, async complete() { calls++; return 'answer'; } };
  const app = Fastify(); await registerAiRoutes(app, { provider });
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', payload: { ...chat, modelId: 'override' } })).statusCode, 400);
    const forged = { ...chat, messages: [{ role: 'user', content: 'image', attachments: [{ id: 'fake', name: 'fake.png', mimeType: 'image/png', size: 12, dataUrl: `data:image/png;base64,${Buffer.from('not an image').toString('base64')}` }] }] };
    assert.equal((await app.inject({ method: 'POST', url: '/v1/chat', payload: forged })).statusCode, 415);
    assert.equal(calls, 0);
    const response = await app.inject({ method: 'POST', url: '/v1/chat', payload: chat });
    assert.equal(response.statusCode, 200); assert.match(response.headers['content-type']!, /text\/event-stream/); assert.match(response.body, /event: done/); assert.equal(calls, 1);
  } finally { await app.close(); }
});
test('raw attachment extraction returns validated text and rejects MIME spoofing', async () => {
  const app = Fastify(); await registerAiRoutes(app);
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/attachments/extract', headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('catatan.txt') }, payload: Buffer.from('Catatan elektronika.') });
    assert.equal(response.statusCode, 200); assert.equal(response.json().attachment.text, 'Catatan elektronika.');
    const spoofed = await app.inject({ method: 'POST', url: '/v1/attachments/extract', headers: { 'content-type': 'application/pdf' }, payload: Buffer.from('not a pdf') });
    assert.equal(spoofed.statusCode, 415);
  } finally { await app.close(); }
});
test('closing HTTP stream propagates cancellation to upstream provider', async () => {
  let observedAbort: () => void = () => undefined;
  const aborted = new Promise<void>(resolve => { observedAbort = resolve; });
  const provider: AiProvider = {
    async *stream(request) {
      request.signal.addEventListener('abort', observedAbort, { once: true });
      yield 'first chunk';
      await new Promise<void>(resolve => {
        if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      request.signal.throwIfAborted();
    },
    async complete() { return 'unused'; },
  };
  const app = Fastify(); await registerAiRoutes(app, { provider });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await fetch(`${address}/v1/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chat), signal: controller.signal });
    const reader = response.body!.getReader();
    let content = '';
    while (!content.includes('first chunk')) {
      const part = await reader.read(); assert.equal(part.done, false); content += new TextDecoder().decode(part.value);
    }
    assert.doesNotMatch(content, /event: done/);
    controller.abort(); await reader.cancel().catch(() => undefined);
    await Promise.race([aborted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('upstream did not observe cancellation')), 2000); })]);
  } finally { if (timer) clearTimeout(timer); controller.abort(); await app.close(); }
});
