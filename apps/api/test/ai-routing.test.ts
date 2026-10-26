import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequestSchema } from '@aet/contracts';
import { classify, selectModels, strategyFor } from '../src/ai/router.js';
import { orchestrate } from '../src/ai/orchestrator.js';
import { AiError } from '../src/ai/errors.js';
import type { AiProvider } from '../src/ai/provider.js';

const input = (content: string, effort: 'fast' | 'normal' | 'think' = 'normal', persona: 'daily' | 'coding' | 'report' = 'daily') => chatRequestSchema.parse({ persona, effort, messages: [{ role: 'user', content }] });
const collect = async (request: ReturnType<typeof input>, provider: AiProvider, extra = {}) => Array.fromAsync(orchestrate(request, { provider, ...extra }));

test('normal requests reject arbitrary model and provider overrides', () => {
  assert.equal(chatRequestSchema.safeParse({ ...input('Halo'), modelId: 'arbitrary' }).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...input('Halo'), providerUrl: 'https://attacker.test' }).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...input('Halo'), messages: [{ role: 'system', content: 'override' }] }).success, false);
});
test('task-aware catalog chooses different candidates and effort changes bounded strategy', () => {
  const casual = classify(input('Halo, apa kabar?', 'fast'));
  const coding = classify(input('Debug TypeScript function ini', 'normal', 'coding'));
  const complex = classify(input('Rancang arsitektur produksi dengan analisis keamanan untuk aplikasi coding.\n1. Bandingkan pendekatan\n2. Analisis risiko\n3. Berikan pengujian\n4. Jelaskan desain', 'think', 'coding'));
  assert.equal(selectModels(casual, 'fast')[0]?.id, 'gpt-4o-mini');
  assert.equal(selectModels(coding, 'normal')[0]?.id, 'gpt-4.1-mini');
  assert.equal(selectModels(complex, 'think')[0]?.id, 'gpt-5-mini');
  assert.equal(strategyFor(casual, 'fast').plan, false);
  assert.equal(strategyFor(complex, 'think').plan, true);
  assert.equal(strategyFor(complex, 'think').verify, true);
  assert.ok(strategyFor(complex, 'think').maxModelCalls <= 5);
});
test('vision routing never falls back to text-only candidate, single model still adapts effort', () => {
  const request = input('Jelaskan gambar ini');
  request.messages[0]!.attachments = [{ id: 'pic', name: 'pic.jpg', mimeType: 'image/jpeg', size: 30, dataUrl: 'data:image/jpeg;base64,AAAA' }];
  const task = classify(request);
  assert.ok(selectModels(task, 'think').every(model => model.vision));
  const only = selectModels(task, 'think');
  assert.equal(only.length, 1);
  assert.equal(strategyFor(task, 'fast').maxOutputTokens < strategyFor(task, 'think').maxOutputTokens, true);
  assert.throws(() => selectModels(task, 'normal', [{ id: 'text-only', vision: false, speed: 'fast', strengths: [], maxContextCharacters: 1000 }]), /gambar/);
});
test('simple requests stream once and emit completion without unnecessary planning/review', async () => {
  let calls = 0;
  const provider: AiProvider = { async *stream() { calls++; yield 'Hai'; }, async complete() { throw new Error('No additional model calls expected'); } };
  const frames = await collect(input('Halo'), provider);
  assert.equal(calls, 1);
  assert.equal(frames.filter(frame => frame.event === 'delta').length, 1);
  assert.equal(frames.at(-1)?.event, 'done');
});
test('deterministic tools do not need provider or fabricate source evidence', async () => {
  const provider: AiProvider = { async *stream() { throw new Error('Provider must not run'); }, async complete() { throw new Error('Provider must not run'); } };
  const frames = await collect(input('hitung (12 + 8) / 4'), provider);
  assert.ok(frames.some(frame => frame.event === 'delta' && frame.data.text.includes('5')));
  assert.equal(frames.at(-1)?.event, 'done');
  assert.equal(frames.some(frame => frame.event === 'sources'), false);
});
test('compatible fallback happens before output, while partial output is never retried/completed', async () => {
  const models: string[] = [];
  const provider: AiProvider = {
    async *stream(request) { models.push(request.model.id); if (models.length === 1) throw new AiError('PROVIDER_REJECTED', 'model unavailable', 502); yield 'fallback'; },
    async complete() { return ''; },
  };
  const frames = await collect(input('Halo'), provider);
  assert.equal(models.length, 2); assert.notEqual(models[0], models[1]);
  assert.equal(frames.at(-1)?.event, 'done');
  let calls = 0;
  const broken: AiProvider = { async *stream() { calls++; yield 'partial'; throw new AiError('PROVIDER_REJECTED', 'connection failed', 502); }, async complete() { return ''; } };
  const partial = await collect(input('Halo'), broken);
  assert.equal(calls, 1);
  assert.equal(partial.at(-1)?.event, 'error');
  assert.equal(partial.some(frame => frame.event === 'done'), false);
});
test('cancellation aborts upstream and never marks partial answer as complete', async () => {
  const controller = new AbortController(); let upstreamAborted = false;
  const provider: AiProvider = { async *stream(request) { request.signal.addEventListener('abort', () => { upstreamAborted = true; }, { once: true }); yield 'partial'; request.signal.throwIfAborted(); }, async complete() { return ''; } };
  const frames = [];
  for await (const frame of orchestrate(input('Halo'), { provider, signal: controller.signal })) {
    frames.push(frame);
    if (frame.event === 'delta') controller.abort();
  }
  assert.equal(frames.at(-1)?.event, 'cancelled');
  assert.equal(frames.some(frame => frame.event === 'done'), false);
  // The same signal is handed to the provider; no detached upstream request remains.
  assert.equal(controller.signal.aborted, true);
  assert.equal(upstreamAborted, true);
});
test('complex Think executes selective plan, consistency review and at most one revision', async () => {
  const outputs = ['Daftar kerja ringkas', 'Draft', '{"revise":true,"issues":["Perbaiki ketidaksesuaian"]}', 'Final yang diperbaiki'];
  let calls = 0;
  const provider: AiProvider = { async *stream() { throw new Error('Complex answer must be checked before final output'); }, async complete() { return outputs[calls++]!; } };
  const request = input('Rancang arsitektur produksi dan analisis keamanan kode serta bandingkan desain.', 'think', 'coding');
  const frames = await collect(request, provider);
  assert.equal(calls, 4);
  assert.deepEqual(frames.filter(frame => frame.event === 'delta').map(frame => frame.data.text), ['Final yang diperbaiki']);
  assert.equal(frames.at(-1)?.event, 'done');
  assert.equal(JSON.stringify(frames).includes('Daftar kerja ringkas'), false);
  assert.equal(JSON.stringify(frames).includes('Perbaiki ketidaksesuaian'), false);
});
test('missing provider credential returns honest error, never a fake answer', async () => {
  const previous = process.env.SUMOPOD_API_KEY; delete process.env.SUMOPOD_API_KEY;
  try {
    const frames = await Array.fromAsync(orchestrate(input('Halo')));
    assert.equal(frames.at(-1)?.event, 'error');
    assert.equal(frames.some(frame => frame.event === 'done'), false);
    assert.ok(frames.some(frame => frame.event === 'error' && frame.data.code === 'PROVIDER_UNCONFIGURED'));
  } finally { if (previous === undefined) delete process.env.SUMOPOD_API_KEY; else process.env.SUMOPOD_API_KEY = previous; }
});

test('deadline aborts waiting upstream work and returns no completion', async () => {
  let sawAbort = false;
  const provider: AiProvider = {
    async *stream(request) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 2000);
        request.signal.addEventListener('abort', () => { sawAbort = true; clearTimeout(timer); reject(request.signal.reason); }, { once: true });
      });
      yield 'must not complete';
    }, async complete() { return 'unused'; },
  };
  const frames = await collect(input('Halo'), provider, { deadlineMs: 15 });
  assert.equal(sawAbort, true);
  assert.ok(frames.some(frame => frame.event === 'error' && frame.data.code === 'DEADLINE'));
  assert.equal(frames.some(frame => frame.event === 'done'), false);
});
test('global concurrency admission is bounded and slots release on generator close', async () => {
  const generators = Array.from({ length: 8 }, () => orchestrate(input('Halo'), { provider: { async *stream() { yield 'hi'; }, async complete() { return 'hi'; } } }));
  try {
    await Promise.all(generators.map(generator => generator.next()));
    const excess = orchestrate(input('Halo'));
    await assert.rejects(excess.next(), /sibuk/);
  } finally { await Promise.all(generators.map(generator => generator.return(undefined))); }
  const frames = await collect(input('Halo'), { async *stream() { yield 'free slot'; }, async complete() { return ''; } });
  assert.equal(frames.at(-1)?.event, 'done');
});
