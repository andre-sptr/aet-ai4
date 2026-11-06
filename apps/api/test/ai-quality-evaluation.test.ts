import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRequestSchema } from '@aet/contracts';
import { classifyHybridHeuristically } from '../src/ai/routing/hybrid-router.js';
import { buildEvaluationMessages, parseQualityEvaluation } from '../src/ai/evaluation/evaluator.js';
import { getDomainRubric } from '../src/ai/evaluation/domain-rubrics.js';
import { evaluateQualityGate } from '../src/ai/evaluation/quality-gate.js';
import type { EvidenceMaterial } from '../src/ai/evaluation/types.js';

function taskProfile(content: string, persona: 'daily' | 'report' | 'coding' = 'report') {
  const request = chatRequestSchema.parse({
    persona,
    effort: 'think',
    messages: [{ role: 'user', content }],
  });
  return classifyHybridHeuristically(request);
}

const evidence: EvidenceMaterial[] = [{
  name: 'tool-search',
  available: true,
  text: 'Dokumen sumber menyatakan bahwa pengujian dilakukan pada 120 responden.',
  sources: [{ id: 'source-1', title: 'Dokumen metodologi', url: 'https://example.org/method' }],
}];

const validEvaluation = {
  scores: {
    relevance: 0.95,
    completeness: 0.9,
    accuracy: 0.92,
    consistency: 0.9,
    clarity: 0.88,
    instructionCompliance: 0.95,
    evidenceSupport: 0.9,
  },
  issues: [],
  evidenceChecks: [{
    claim: 'Penelitian melibatkan 120 responden.',
    sourceId: 'source-1',
    status: 'supported',
  }],
  evaluatorConfidence: 0.91,
};

test('domain rubric uses different weights for research, coding, math and writing', () => {
  const research = getDomainRubric(taskProfile('Tinjau penelitian dan jurnal terdahulu.'));
  const math = getDomainRubric(taskProfile('Hitung regresi dan statistik data panel.'));
  const writing = getDomainRubric(taskProfile('Tulis esai akademik dengan bahasa formal.', 'daily'));
  assert.ok((math.weights.accuracy ?? 0) > (writing.weights.accuracy ?? 0));
  assert.ok((research.weights.evidenceSupport ?? 0) > 0);
  assert.ok((writing.weights.instructionCompliance ?? 0) > (research.weights.instructionCompliance ?? 0));
});

test('evaluation prompt includes domain criteria and supplied evidence IDs as untrusted material', () => {
  const task = taskProfile('Analisis penelitian dan referensi jurnal.');
  const messages = buildEvaluationMessages(
    [{ role: 'system', content: 'Base system.' }, { role: 'user', content: 'Analisis penelitian.' }],
    'Jawaban draft.',
    task,
    evidence,
  );
  const systemText = messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n');
  assert.match(systemText, /Domain evaluasi: research/);
  assert.match(systemText, /source-1/);
  const evidenceMessage = messages.find(message => message.role === 'user' && String(message.content).includes('Dokumen sumber'));
  assert.ok(evidenceMessage);
});

test('quality evaluator accepts valid scores and only source IDs supplied by context', () => {
  const parsed = parseQualityEvaluation(JSON.stringify(validEvaluation), evidence);
  assert.ok(parsed);
  assert.equal(parsed?.scores.accuracy, 0.92);
  assert.equal(parsed?.evidenceAvailable, true);
  assert.equal(parsed?.evidenceChecks[0]?.status, 'supported');
});

test('quality evaluator rejects invalid score ranges, malformed issues and fabricated source IDs', () => {
  const badScore = structuredClone(validEvaluation);
  badScore.scores.accuracy = 1.5;
  assert.equal(parseQualityEvaluation(JSON.stringify(badScore), evidence), null);

  const badSource = structuredClone(validEvaluation);
  badSource.evidenceChecks[0]!.sourceId = 'invented-source';
  assert.equal(parseQualityEvaluation(JSON.stringify(badSource), evidence), null);

  const missingEvidenceScore = structuredClone(validEvaluation);
  missingEvidenceScore.scores.evidenceSupport = null;
  assert.equal(parseQualityEvaluation(JSON.stringify(missingEvidenceScore), evidence), null);

  const badIssue = structuredClone(validEvaluation);
  badIssue.issues = [{ dimension: 'accuracy', severity: 'critical', description: 'bad' }];
  assert.equal(parseQualityEvaluation(JSON.stringify(badIssue), evidence), null);
});

test('quality gate accepts a strong research answer supported by supplied evidence', () => {
  const task = taskProfile('Analisis penelitian dan referensi jurnal.');
  const evaluation = parseQualityEvaluation(JSON.stringify(validEvaluation), evidence);
  assert.ok(evaluation);
  const gate = evaluateQualityGate(evaluation, task);
  assert.equal(gate.status, 'accepted');
  assert.equal(gate.evidenceStatus, 'checked_against_supplied_sources');
  assert.ok((gate.score ?? 0) >= gate.threshold);
});

test('quality gate requires revision for low scores and blocks high-severity accuracy issues', () => {
  const task = taskProfile('Analisis penelitian dan referensi jurnal.');
  const low = structuredClone(validEvaluation);
  low.scores.accuracy = 0.35;
  low.scores.completeness = 0.45;
  low.issues = [{ dimension: 'accuracy', severity: 'medium', description: 'Klaim utama belum didukung.' }];
  const lowEvaluation = parseQualityEvaluation(JSON.stringify(low), evidence);
  assert.equal(evaluateQualityGate(lowEvaluation, task).status, 'revision_required');

  const critical = structuredClone(validEvaluation);
  critical.issues = [{ dimension: 'accuracy', severity: 'high', description: 'Angka bertentangan dengan bukti.' }];
  critical.evidenceChecks[0]!.status = 'contradicted';
  const criticalEvaluation = parseQualityEvaluation(JSON.stringify(critical), evidence);
  const decision = evaluateQualityGate(criticalEvaluation, task);
  assert.equal(decision.status, 'revision_required');
  assert.equal(decision.blockingIssues.length, 1);
  assert.equal(decision.evidenceStatus, 'insufficient_evidence');
});

test('missing evaluator output is never mislabeled as passed', () => {
  const task = taskProfile('Jelaskan konsep secara kompleks.');
  const gate = evaluateQualityGate(null, task);
  assert.equal(gate.status, 'review_unavailable');
  assert.equal(gate.score, null);
});

test('no supplied evidence is marked not applicable, not falsely verified', () => {
  const task = taskProfile('Jelaskan konsep secara sederhana.');
  const noEvidence = { ...validEvaluation, scores: { ...validEvaluation.scores, evidenceSupport: null }, evidenceChecks: [] };
  const parsed = parseQualityEvaluation(JSON.stringify(noEvidence), []);
  assert.ok(parsed);
  const gate = evaluateQualityGate(parsed, task);
  assert.equal(gate.evidenceStatus, 'not_applicable');
});


test('verification-required tasks are not accepted when supplied evidence was not actually checked', () => {
  const task = taskProfile('Analisis dan bandingkan metode penelitian serta referensi jurnal terdahulu secara komprehensif.');
  const unverified = {
    ...validEvaluation,
    evidenceChecks: [],
  };
  const parsed = parseQualityEvaluation(JSON.stringify(unverified), evidence);
  assert.ok(parsed);
  const gate = evaluateQualityGate(parsed, task);
  assert.equal(gate.status, 'revision_required');
  assert.equal(gate.evidenceStatus, 'insufficient_evidence');
});
