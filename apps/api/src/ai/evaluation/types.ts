export type QualityDimension =
  | 'relevance'
  | 'completeness'
  | 'accuracy'
  | 'consistency'
  | 'clarity'
  | 'instructionCompliance'
  | 'evidenceSupport';

export type IssueSeverity = 'low' | 'medium' | 'high';

export type EvaluationIssue = {
  dimension: QualityDimension;
  severity: IssueSeverity;
  description: string;
};

export type EvidenceCheck = {
  claim: string;
  sourceId: string;
  status: 'supported' | 'contradicted' | 'insufficient';
};

export type QualityScores = {
  relevance: number;
  completeness: number;
  accuracy: number;
  consistency: number;
  clarity: number;
  instructionCompliance: number;
  evidenceSupport?: number;
};

export type QualityEvaluation = {
  scores: QualityScores;
  issues: EvaluationIssue[];
  evidenceChecks: EvidenceCheck[];
  evidenceAvailable: boolean;
  evaluatorConfidence: number;
};

export type QualityGateDecision = {
  status: 'accepted' | 'revision_required' | 'review_unavailable';
  score: number | null;
  threshold: number;
  blockingIssues: EvaluationIssue[];
  issueCount: number;
  reasons: string[];
  evidenceStatus: 'checked_against_supplied_sources' | 'insufficient_evidence' | 'not_applicable';
};

export type EvidenceMaterial = {
  name: string;
  available: boolean;
  text: string;
  sources: Array<{ id: string; title: string; url: string }>;
};
