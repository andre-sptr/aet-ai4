import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequestSchema } from '@aet/contracts';
import { classifyHybrid, classifyHybridHeuristically, selectModelsHybrid } from '../src/ai/routing/hybrid-router.js';
import { getModelRegistry } from '../src/ai/models/registry.js';
import type { ModelSpec } from '../src/ai/models.js';

const input = (content: string, effort: 'fast' | 'normal' | 'think' = 'normal', persona: 'daily' | 'coding' | 'report' = 'daily') =>
  chatRequestSchema.parse({ persona, effort, messages: [{ role: 'user', content }] });

test('V2 heuristic classifier enriches the legacy task without changing core classification fields', () => {
  const request = input('Analisis regresi data panel untuk penelitian profitabilitas perusahaan dengan pengujian asumsi klasik. Bandingkan model regresi dan analisis keamanan data.', 'think', 'report');
  const task = classifyHybridHeuristically(request);
  assert.equal(task.taskType, 'research');
  assert.equal(task.complexity, 'complex');
  assert.ok(task.domain.includes('research'));
  assert.ok(task.domain.includes('quantitative'));
  assert.equal(task.reasoningLevel, 'high');
  assert.equal(task.accuracyRequirement, 'high');
  assert.equal(typeof task.confidence, 'number');
});

test('hybrid classifier invokes semantic classifier only when heuristic confidence requires it', async () => {
  const simple = await classifyHybrid(input('Halo'), { semanticClassifier: async () => { throw new Error('must not call'); } });
  assert.equal(simple.taskType, 'general');

  const ambiguous = input('Buat analisis penelitian dan implementasi Python untuk mengolah data statistik serta menyusun laporan akademik dengan evaluasi keamanan.');
  const heuristic = classifyHybridHeuristically(ambiguous);
  assert.equal(heuristic.needsSemanticClassification, true);
  let invoked = 0;
  const refined = await classifyHybrid(ambiguous, {
    semanticClassifier: async () => {
      invoked++;
      return { taskType: 'coding', complexity: 'complex', domain: ['data-science', 'software-engineering'], reasoningLevel: 'high', accuracyRequirement: 'high', needsTools: true, needsVerification: true };
    },
  });
  assert.equal(invoked, 1);
  assert.equal(refined.taskType, 'coding');
  assert.equal(refined.complexity, 'complex');
  assert.equal(refined.needsTools, true);
});

test('invalid semantic output falls back to safe heuristic profile', async () => {
  const request = input('Tolong analisis data dan buatkan program Python untuk regresi statistik.');
  const heuristic = classifyHybridHeuristically(request);
  const result = await classifyHybrid(request, { semanticClassifier: async () => ({ taskType: 'not-a-task' as never }) });
  assert.equal(result.taskType, heuristic.taskType);
  assert.equal(result.complexity, heuristic.complexity);
});

test('semantic refinement cannot downgrade heuristic complexity or verification safeguards', async () => {
  const request = input('Rancang arsitektur produksi dengan analisis keamanan, evaluasi risiko, dan pembuktian mitigasi.', 'think', 'coding');
  const heuristic = classifyHybridHeuristically(request);
  const result = await classifyHybrid(request, { semanticClassifier: async () => ({
    taskType: 'coding', complexity: 'simple', reasoningLevel: 'low', accuracyRequirement: 'standard', needsTools: false, needsVerification: false,
  }) });
  assert.equal(result.complexity, heuristic.complexity);
  assert.equal(result.needsVerification, true);
});

test('model registry preserves catalog IDs and marks provider availability as unknown, not verified', () => {
  const registry = getModelRegistry();
  assert.deepEqual(registry.map(model => model.id), ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5-mini']);
  assert.ok(registry.every(model => model.provider === 'sumopod' && model.availability === 'unknown' && model.enabled));
  const disabled = getModelRegistry(undefined, { disabledModelIds: ['gpt-5-mini'] });
  assert.equal(disabled.find(model => model.id === 'gpt-5-mini')?.enabled, false);
});

test('V2 model selection respects vision and context hard constraints', () => {
  const visionRequest = input('Jelaskan gambar ini');
  visionRequest.messages[0]!.attachments = [{ id: 'pic', name: 'pic.jpg', mimeType: 'image/jpeg', size: 20, dataUrl: 'data:image/jpeg;base64,AAAA' }];
  const visionTask = classifyHybridHeuristically(visionRequest);
  const visionModels = selectModelsHybrid(visionTask, 'think');
  assert.deepEqual(visionModels.map(model => model.id), ['gpt-4o-mini']);

  const task = classifyHybridHeuristically(input('Jelaskan konsep ini'));
  const shortContextOnly: ModelSpec[] = [{ id: 'tiny', strengths: ['general'], speed: 'fast', vision: false, maxContextCharacters: 5 }];
  assert.throws(() => selectModelsHybrid(task, 'normal', shortContextOnly), /Konteks terlalu panjang/);
});

test('V2 selection prefers task capability and effort profile', () => {
  const coding = classifyHybridHeuristically(input('Debug TypeScript function ini dan jelaskan perbaikannya.', 'normal', 'coding'));
  assert.equal(selectModelsHybrid(coding, 'normal')[0]?.id, 'gpt-4.1-mini');

  const complex = classifyHybridHeuristically(input('Rancang arsitektur produksi dengan analisis keamanan dan evaluasi risiko yang komprehensif.', 'think', 'coding'));
  assert.equal(selectModelsHybrid(complex, 'think')[0]?.id, 'gpt-5-mini');
});
