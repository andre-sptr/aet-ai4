# AET Quality Evaluation Engine — Phase 4

## Scope
Phase 4 adds domain-aware quality scoring, an evidence-aware evaluation prompt, a deterministic quality gate, conditional revision, and optional post-revision re-evaluation to the adaptive multi-model pipeline.

It does not replace the legacy direct/Think verification path. It is activated only inside the Phase 3 adaptive multi-model pipeline.

## Activation
Set these backend environment variables:

```env
AI_ROUTER_V2=true
AI_MULTI_MODEL_ORCHESTRATION=true
AI_QUALITY_EVALUATION=true
```

`AI_PROMPT_PREPARATION` and `AI_SEMANTIC_CLASSIFIER` remain independently configurable.

If `AI_QUALITY_EVALUATION=false`, the Phase 3 reviewer behavior remains in place.

## Evaluation dimensions
- Relevance
- Completeness
- Accuracy
- Consistency
- Clarity
- Instruction compliance
- Evidence support (only when source material is actually supplied)

## Domain rubrics
Separate weighting and review focus are provided for general, writing, research, coding, math, document, and image tasks. Weights are policy defaults and should be calibrated against human-reviewed benchmark sets before being treated as performance claims.

## Evidence rules
- Evidence can come from tool results and extracted text attachments.
- Each source is assigned an allowlisted ID.
- The evaluator may reference only source IDs supplied to it.
- Unsupported or contradictory claims are not marked as supported. A `checked_against_supplied_sources` status means an LLM compared selected claims with supplied material; it is not an independent guarantee of truth.
- If no source material is available, evidence support is not applicable; the system does not claim external verification.
- A contradiction against supplied evidence creates a high-severity blocker.

## Quality gate
Initial thresholds:
- Simple: 0.72
- Moderate: 0.77
- Complex: 0.82
- Critical accuracy requirement: 0.88

A weighted domain score is calculated from validated dimensions, with minimum floors for accuracy, instruction compliance, and completeness so a high average cannot hide a weak critical dimension. Evaluator confidence below 0.45 is treated as unavailable rather than accepted. Missing evidenceSupport is excluded from the weighted average. High-severity accuracy, instruction-compliance, or evidence issues block finalization. Evidence contradictions are always blocking.

If the evaluator response is invalid, the answer is marked `review_unavailable`, not passed. The answer may still be returned in balanced mode, with the evaluation-unavailable status exposed in metadata.

If a revision is required, one revision is attempted only when the execution budget permits. A post-revision evaluation is run only if another model call remains. If there is no budget for re-evaluation, metadata explicitly reports that the recheck is pending; the system never labels that result as passed.

## Execution budget
Quality evaluation uses the existing Phase 3 model-call budget:
- Planner: 1
- Generator: up to 2, reduced dynamically to reserve an evaluator and potential revision
- Evaluator: 1
- Reviser: at most 1
- Re-evaluator: at most 1, only if budget remains

No unbounded loops or recursive model calls are introduced.

## Metadata
The existing SSE contract is preserved. `metadata` gains an optional `qualityEvaluation` object:
- available
- status
- score
- threshold
- evidenceStatus
- issueCount
- reasons
- postRevisionRechecked

## Tests
`apps/api/test/ai-quality-evaluation.test.ts` covers domain rubric differences, evaluator prompt evidence handling, score validation, source ID allowlisting, quality gate acceptance/revision/blocking, and unavailable evidence/evaluator states.

The adaptive orchestration test suite also covers the quality evaluation -> revision -> re-evaluation path within a fixed model-call budget.

## Validation
Run on the supported Node.js 24+ environment:

```powershell
npm run typecheck
npm test
```

## Rollback
Set `AI_QUALITY_EVALUATION=false` and restart the API. Phase 3 reviewer behavior remains available.
