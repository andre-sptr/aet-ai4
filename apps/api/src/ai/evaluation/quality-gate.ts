import type { TaskProfile } from '../routing/hybrid-router.js';
import { getDomainRubric } from './domain-rubrics.js';
import type { QualityEvaluation, QualityGateDecision, QualityDimension } from './types.js';

export function evaluateQualityGate(
  evaluation: QualityEvaluation | null,
  task: TaskProfile,
  evidenceAvailable = false,
): QualityGateDecision {
  const threshold = task.accuracyRequirement === 'critical'
    ? 0.88
    : task.complexity === 'complex'
      ? 0.82
      : task.complexity === 'moderate'
        ? 0.77
        : 0.72;

  if (!evaluation) {
    return {
      status: 'review_unavailable',
      score: null,
      threshold,
      blockingIssues: [],
      issueCount: 0,
      reasons: ['Evaluator tidak menghasilkan laporan terstruktur yang valid; kualitas tidak dinyatakan lulus.'],
      evidenceStatus: evidenceAvailable ? 'insufficient_evidence' : 'not_applicable',
    };
  }

  if (evaluation.evaluatorConfidence < 0.45) {
    const lowConfidenceBlockers = evaluation.issues.filter(issue =>
      issue.severity === 'high' &&
      (issue.dimension === 'accuracy' || issue.dimension === 'instructionCompliance' || issue.dimension === 'evidenceSupport'),
    );
    if (evaluation.evidenceChecks.some(check => check.status === 'contradicted')) {
      lowConfidenceBlockers.push({
        dimension: 'evidenceSupport',
        severity: 'high',
        description: 'Satu atau lebih klaim bertentangan dengan sumber yang disediakan.',
      });
    }
    return {
      status: 'review_unavailable',
      score: null,
      threshold,
      blockingIssues: lowConfidenceBlockers,
      issueCount: evaluation.issues.length,
      reasons: ['Keyakinan evaluator terlalu rendah untuk menetapkan status lulus atau gagal.'],
      evidenceStatus: evaluation.evidenceAvailable ? 'insufficient_evidence' : 'not_applicable',
    };
  }

  const rubric = getDomainRubric(task);
  const entries = Object.entries(rubric.weights) as [QualityDimension, number][];
  let weighted = 0;
  let totalWeight = 0;
  for (const [dimension, weight] of entries) {
    if (weight <= 0) continue;
    if (dimension === 'evidenceSupport' && evaluation.scores.evidenceSupport === undefined) continue;
    const value = evaluation.scores[dimension];
    if (typeof value !== 'number') continue;
    weighted += value * weight;
    totalWeight += weight;
  }
  const score = totalWeight > 0 ? Number((weighted / totalWeight).toFixed(4)) : null;

  const evidenceContradictions = evaluation.evidenceChecks.filter(check => check.status === 'contradicted');
  const evidenceInsufficient = evaluation.evidenceChecks.filter(check => check.status === 'insufficient');
  const blockingIssues = evaluation.issues.filter(issue =>
    issue.severity === 'high' &&
    (issue.dimension === 'accuracy' || issue.dimension === 'instructionCompliance' || issue.dimension === 'evidenceSupport'),
  );
  if (
    evidenceContradictions.length > 0 &&
    !blockingIssues.some(issue =>
      issue.dimension === 'accuracy' || issue.dimension === 'evidenceSupport',
    )
  ) {
    blockingIssues.push({
      dimension: 'evidenceSupport',
      severity: 'high',
      description: 'Satu atau lebih klaim bertentangan dengan sumber yang disediakan.',
    });
  }

  const reasons: string[] = [];
  if (score === null || score < threshold) reasons.push(`Skor kualitas ${score ?? 'tidak tersedia'} berada di bawah ambang ${threshold}.`);

  // Prevent a strong average from hiding a severe weakness in a critical dimension.
  const accuracyFloor = task.accuracyRequirement === 'critical'
    ? 0.80
    : task.taskType === 'math' ? 0.70 : 0.60;
  const dimensionFailures: string[] = [];
  if (evaluation.scores.accuracy < accuracyFloor) {
    dimensionFailures.push(`Skor akurasi ${evaluation.scores.accuracy} di bawah batas minimum ${accuracyFloor}.`);
  }
  if (evaluation.scores.instructionCompliance < 0.65) {
    dimensionFailures.push('Skor kepatuhan instruksi berada di bawah batas minimum 0.65.');
  }
  if (evaluation.scores.completeness < 0.55) {
    dimensionFailures.push('Skor kelengkapan berada di bawah batas minimum 0.55.');
  }
  reasons.push(...dimensionFailures);
  if (blockingIssues.length) reasons.push('Terdapat masalah berkeparahan tinggi pada akurasi, kepatuhan instruksi, atau dukungan bukti.');
  if (evidenceContradictions.length) reasons.push('Terdapat klaim yang bertentangan dengan sumber yang disediakan.');
  const requiresEvidenceCheck =
    task.needsVerification ||
    task.taskType === 'research' ||
    task.accuracyRequirement === 'critical';
  const evidenceFailure =
    requiresEvidenceCheck &&
    evaluation.evidenceAvailable &&
    (evidenceContradictions.length > 0 ||
      evidenceInsufficient.length > 0 ||
      evaluation.evidenceChecks.length === 0 ||
      (evaluation.scores.evidenceSupport !== undefined && evaluation.scores.evidenceSupport < 0.65));
  if (evidenceFailure) reasons.push('Dukungan bukti belum cukup untuk klaim yang memerlukan verifikasi.');

  const evidenceStatus = !evaluation.evidenceAvailable
    ? 'not_applicable'
    : evidenceContradictions.length
      ? 'insufficient_evidence'
      : evidenceInsufficient.length || evaluation.evidenceChecks.length === 0
        ? 'insufficient_evidence'
        : 'checked_against_supplied_sources';

  const accepted =
    score !== null &&
    score >= threshold &&
    blockingIssues.length === 0 &&
    dimensionFailures.length === 0 &&
    evidenceContradictions.length === 0 &&
    !evidenceFailure;

  return {
    status: accepted ? 'accepted' : 'revision_required',
    score,
    threshold,
    blockingIssues,
    issueCount: evaluation.issues.length + (
      evidenceContradictions.length > 0 &&
      !evaluation.issues.some(issue =>
        issue.severity === 'high' &&
        (issue.dimension === 'accuracy' || issue.dimension === 'evidenceSupport'),
      ) ? 1 : 0
    ),
    reasons: reasons.length ? reasons : ['Skor memenuhi ambang dan tidak ditemukan masalah penghalang.'],
    evidenceStatus,
  };
}
