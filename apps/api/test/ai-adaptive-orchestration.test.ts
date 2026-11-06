import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequestSchema } from '@aet/contracts';
import type { AiProvider, ProviderRequest } from '../src/ai/provider.js';
import { classifyHybridHeuristically } from '../src/ai/routing/hybrid-router.js';
import { getModelRegistry } from '../src/ai/models/registry.js';
import { runAdaptivePipeline, type AdaptivePipelineEvent } from '../src/ai/orchestration/adaptive-pipeline.js';
import { AiError } from '../src/ai/errors.js';
import { parsePlan } from '../src/ai/agents/planner.js';
import { parseReview } from '../src/ai/agents/reviewer.js';

function taskProfile() {
  const request = chatRequestSchema.parse({
    persona: 'report',
    effort: 'think',
    messages: [{
      role: 'user',
      content: 'Analisis penelitian kompleks tentang regresi data panel, bandingkan pendekatan statistik, susun metodologi dan evaluasi keterbatasannya secara terstruktur.',
    }],
  });
  return classifyHybridHeuristically(request);
}

function fakeProvider(outputs: string[], calls: ProviderRequest[]): AiProvider {
  return {
    async *stream() { yield 'unused'; },
    async complete(request) {
      calls.push(request);
      const output = outputs.shift();
      if (!output) throw new Error('Unexpected provider call');
      return output;
    },
  };
}

test('planner output is strictly bounded and rejects malformed or oversized plans', () => {
  const valid = parsePlan(JSON.stringify({
    subtasks: [
      { title: 'Analisis metode', instruction: 'Bandingkan metode statistik.', taskType: 'math' },
      { title: 'Sintesis penelitian', instruction: 'Susun implikasi penelitian.', taskType: 'research' },
    ],
  }), 'general');
  assert.equal(valid?.length, 2);
  assert.equal(parsePlan('not-json', 'general'), null);
  assert.equal(parsePlan(JSON.stringify({ subtasks: Array.from({ length: 3 }, () => ({ title: 'x', instruction: 'y', taskType: 'general' })) }), 'general'), null);
});

test('review output is validated and bounded', () => {
  assert.deepEqual(parseReview('{"revise":true,"issues":["kurang lengkap"]}'), {
    revise: true,
    issues: ['kurang lengkap'],
  });
  assert.equal(parseReview('{"revise":"yes","issues":[]}'), null);
  assert.equal(parseReview('{"revise":true,"issues":["x","x","x","x"]}'), null);
});

test('adaptive pipeline plans, selects models per subtask, reviews and performs at most one revision', async () => {
  const calls: ProviderRequest[] = [];
  const provider = fakeProvider([
    JSON.stringify({
      subtasks: [
        { title: 'Analisis kuantitatif', instruction: 'Analisis metode regresi panel.', taskType: 'math' },
        { title: 'Sintesis penelitian', instruction: 'Sintesis implikasi penelitian.', taskType: 'research' },
      ],
    }),
    'Hasil analisis kuantitatif.',
    'Hasil sintesis penelitian.',
    '{"revise":true,"issues":["Hubungan kedua bagian belum dijelaskan."]}',
    'Jawaban final yang telah diperbaiki.',
  ], calls);
  const events: AdaptivePipelineEvent[] = [];
  for await (const event of runAdaptivePipeline({
    provider,
    messages: [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Analisis penelitian dan regresi data panel.' },
    ],
    task: taskProfile(),
    effort: 'think',
    candidates: getModelRegistry(),
    signal: new AbortController().signal,
    maxModelCalls: 5,
    maxOutputTokens: 2000,
  })) events.push(event);

  const result = events.find(event => event.type === 'result');
  assert.ok(result && result.type === 'result');
  if (!result || result.type !== 'result') return;
  assert.equal(result.answer, 'Jawaban final yang telah diperbaiki.');
  assert.equal(result.callsUsed, 5);
  assert.equal(result.subtasks, 2);
  assert.equal(result.reviewed, true);
  assert.equal(result.revised, true);
  assert.equal(calls.length, 5);
  assert.ok(new Set(calls.map(call => call.model.id)).size >= 2);
});

test('adaptive pipeline does not exceed the configured model-call budget', async () => {
  const calls: ProviderRequest[] = [];
  const provider = fakeProvider([
    JSON.stringify({ subtasks: [{ title: 'Bagian', instruction: 'Kerjakan.', taskType: 'research' }] }),
    'Jawaban.',
    '{"revise":false,"issues":[]}',
  ], calls);
  let result: unknown;
  for await (const event of runAdaptivePipeline({
    provider,
    messages: [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Analisis penelitian.' },
    ],
    task: taskProfile(),
    effort: 'normal',
    candidates: getModelRegistry(),
    signal: new AbortController().signal,
    maxModelCalls: 3,
    maxOutputTokens: 1000,
  })) {
    if (event.type === 'result') result = event;
  }
  assert.ok(result && typeof result === 'object');
  assert.equal(calls.length, 3);
});

test('adaptive pipeline aborts before making another provider call', async () => {
  const calls: ProviderRequest[] = [];
  const controller = new AbortController();
  const provider: AiProvider = {
    async *stream() { yield 'unused'; },
    async complete(request) {
      calls.push(request);
      controller.abort();
      return JSON.stringify({ subtasks: [{ title: 'Part', instruction: 'Do task', taskType: 'general' }] });
    },
  };
  await assert.rejects(async () => {
    for await (const _event of runAdaptivePipeline({
      provider,
      messages: [
        { role: 'system', content: 'System prompt.' },
        { role: 'user', content: 'Analisis kompleks.' },
      ],
      task: taskProfile(),
      effort: 'think',
      candidates: getModelRegistry(),
      signal: controller.signal,
      maxModelCalls: 5,
      maxOutputTokens: 1000,
    })) { /* consume */ }
  });
  assert.equal(calls.length, 1);
});


test('adaptive pipeline can switch once to another eligible model after a retryable provider failure', async () => {
  const calls: ProviderRequest[] = [];
  let first = true;
  const provider: AiProvider = {
    async *stream() { yield 'unused'; },
    async complete(request) {
      calls.push(request);
      if (first) {
        first = false;
        throw new AiError('PROVIDER_REJECTED', 'provider unavailable', 502);
      }
      if (calls.length === 2) {
        return JSON.stringify({
          subtasks: [{ title: 'Analisis', instruction: 'Analisis inti.', taskType: 'research' }],
        });
      }
      if (calls.length === 3) return 'Hasil analisis.';
      return '{"revise":false,"issues":[]}';
    },
  };

  let result: { answer: string; modelsUsed: string[] } | undefined;
  for await (const event of runAdaptivePipeline({
    provider,
    messages: [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Analisis penelitian kompleks.' },
    ],
    task: taskProfile(),
    effort: 'normal',
    candidates: getModelRegistry(),
    signal: new AbortController().signal,
    maxModelCalls: 5,
    maxOutputTokens: 1000,
  })) {
    if (event.type === 'result') result = event;
  }

  assert.ok(result);
  assert.equal(result?.answer, 'Hasil analisis.');
  assert.ok(calls.length >= 4);
  assert.notEqual(calls[0]?.model.id, calls[1]?.model.id);
  assert.ok(result?.modelsUsed.includes(calls[1]!.model.id));
});


test('quality-enabled adaptive pipeline evaluates, revises and rechecks within its model-call budget', async () => {
  const calls: ProviderRequest[] = [];
  const high = {
    scores: {
      relevance: 0.95, completeness: 0.94, accuracy: 0.93,
      consistency: 0.92, clarity: 0.9, instructionCompliance: 0.96,
      evidenceSupport: null,
    },
    issues: [],
    evidenceChecks: [],
    evaluatorConfidence: 0.92,
  };
  const low = {
    scores: {
      relevance: 0.9, completeness: 0.85, accuracy: 0.35,
      consistency: 0.85, clarity: 0.9, instructionCompliance: 0.9,
      evidenceSupport: null,
    },
    issues: [{ dimension: 'accuracy', severity: 'medium', description: 'Klaim metodologis belum cukup dijelaskan.' }],
    evidenceChecks: [],
    evaluatorConfidence: 0.9,
  };
  const provider = fakeProvider([
    JSON.stringify({ subtasks: [{ title: 'Analisis', instruction: 'Analisis metode penelitian.', taskType: 'research' }] }),
    'Draft penelitian awal.',
    JSON.stringify(low),
    'Draft penelitian hasil revisi.',
    JSON.stringify(high),
  ], calls);

  let result: Extract<AdaptivePipelineEvent, { type: 'result' }> | undefined;
  for await (const event of runAdaptivePipeline({
    provider,
    messages: [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Analisis penelitian secara mendalam.' },
    ],
    task: taskProfile(),
    effort: 'think',
    candidates: getModelRegistry(),
    signal: new AbortController().signal,
    maxModelCalls: 5,
    maxOutputTokens: 1500,
    qualityEvaluation: true,
    evidence: [],
  })) {
    if (event.type === 'result') result = event;
  }

  assert.ok(result);
  assert.equal(result?.answer, 'Draft penelitian hasil revisi.');
  assert.equal(result?.callsUsed, 5);
  assert.equal(result?.revised, true);
  assert.equal(result?.qualityGate?.status, 'accepted');
  assert.equal(result?.evaluationAvailable, true);
  assert.equal(result?.postRevisionRechecked, true);
  assert.equal(calls.length, 5);
});

test('quality-enabled pipeline keeps evaluator-unavailable state explicit', async () => {
  const calls: ProviderRequest[] = [];
  const provider = fakeProvider([
    JSON.stringify({ subtasks: [{ title: 'Analisis', instruction: 'Jawab tugas.', taskType: 'research' }] }),
    'Draft jawaban.',
    'not-json',
  ], calls);

  let result: Extract<AdaptivePipelineEvent, { type: 'result' }> | undefined;
  for await (const event of runAdaptivePipeline({
    provider,
    messages: [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'Analisis penelitian.' },
    ],
    task: taskProfile(),
    effort: 'normal',
    candidates: getModelRegistry(),
    signal: new AbortController().signal,
    maxModelCalls: 4,
    maxOutputTokens: 1000,
    qualityEvaluation: true,
    evidence: [],
  })) {
    if (event.type === 'result') result = event;
  }

  assert.ok(result);
  assert.equal(result?.qualityGate?.status, 'review_unavailable');
  assert.equal(result?.evaluationAvailable, false);
  assert.equal(result?.reviewed, false);
  assert.equal(result?.answer, 'Draft jawaban.');
});
